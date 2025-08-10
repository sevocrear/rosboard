#!/usr/bin/env python3

import asyncio
import importlib
import os
import socket
import threading
import time
import tornado, tornado.web, tornado.websocket
import traceback

if os.environ.get("ROS_VERSION") == "1":
    import rospy # ROS1
elif os.environ.get("ROS_VERSION") == "2":
    import rosboard.rospy2 as rospy # ROS2
    from rclpy.qos import HistoryPolicy, QoSProfile, QoSReliabilityPolicy, QoSDurabilityPolicy
else:
    print("ROS not detected. Please source your ROS environment\n(e.g. 'source /opt/ros/DISTRO/setup.bash')")
    exit(1)

from rosgraph_msgs.msg import Log

from rosboard.serialization import ros2dict
from rosboard.subscribers.dmesg_subscriber import DMesgSubscriber
from rosboard.subscribers.processes_subscriber import ProcessesSubscriber
from rosboard.subscribers.system_stats_subscriber import SystemStatsSubscriber
from rosboard.subscribers.dummy_subscriber import DummySubscriber
from rosboard.handlers import ROSBoardSocketHandler, NoCacheStaticFileHandler

class ROSBoardNode(object):
    instance = None
    def __init__(self, node_name = "rosboard_node"):
        self.__class__.instance = self
        rospy.init_node(node_name)
        self.port = rospy.get_param("~port", 8888)
        self.title = rospy.get_param("~title", socket.gethostname())

        # desired subscriptions of all the websockets connecting to this instance.
        # these remote subs are updated directly by "friend" class ROSBoardSocketHandler.
        # this class will read them and create actual ROS subscribers accordingly.
        # dict of topic_name -> set of sockets
        self.remote_subs = {}

        # actual ROS subscribers.
        # dict of topic_name -> ROS Subscriber
        self.local_subs = {}

        # minimum update interval per topic (throttle rate) amang all subscribers to a particular topic.
        # we can throw data away if it arrives faster than this
        # dict of topic_name -> float (interval in seconds)
        self.update_intervals_by_topic = {}

        # last time data arrived for a particular topic
        # dict of topic_name -> float (time in seconds)
        self.last_data_times_by_topic = {}

        # publishers cache: topic_name -> rospy.Publisher
        self.local_pubs = {}

        if rospy.__name__ == "rospy2":
            # ros2 hack: need to subscribe to at least 1 topic
            # before dynamic subscribing will work later.
            # ros2 docs don't explain why but we need this magic.
            self.sub_rosout = rospy.Subscriber("/rosout", Log, lambda x:x)

        tornado_settings = {
            'debug': True,
            'static_path': os.path.join(os.path.dirname(os.path.realpath(__file__)), 'html')
        }

        tornado_handlers = [
                (r"/rosboard/v1", ROSBoardSocketHandler, {
                    "node": self,
                }),
                (r"/(.*)", NoCacheStaticFileHandler, {
                    "path": tornado_settings.get("static_path"),
                    "default_filename": "index.html"
                }),
        ]

        self.event_loop = None
        self.tornado_application = tornado.web.Application(tornado_handlers, **tornado_settings)
        asyncio.set_event_loop(asyncio.new_event_loop())
        self.event_loop = tornado.ioloop.IOLoop()
        self.tornado_application.listen(self.port)

        # allows tornado to log errors to ROS
        self.logwarn = rospy.logwarn
        self.logerr = rospy.logerr

        # tornado event loop. all the web server and web socket stuff happens here
        threading.Thread(target = self.event_loop.start, daemon = True).start()

        # loop to sync remote (websocket) subs with local (ROS) subs
        threading.Thread(target = self.sync_subs_loop, daemon = True).start()

        # loop to keep track of latencies and clock differences for each socket
        threading.Thread(target = self.pingpong_loop, daemon = True).start()

        self.lock = threading.Lock()

        rospy.loginfo("ROSboard listening on :%d" % self.port)

    def start(self):
        rospy.spin()

    def get_msg_class(self, msg_type):
        """
        Given a ROS message type specified as a string, e.g.
            "std_msgs/Int32"
        or
            "std_msgs/msg/Int32"
        it imports the message class into Python and returns the class, i.e. the actual std_msgs.msg.Int32

        Returns none if the type is invalid (e.g. if user hasn't bash-sourced the message package).
        """
        try:
            msg_module, dummy, msg_class_name = msg_type.replace("/", ".").rpartition(".")
        except ValueError:
            rospy.logerr("invalid type %s" % msg_type)
            return None

        try:
            if not msg_module.endswith(".msg"):
                msg_module = msg_module + ".msg"
            return getattr(importlib.import_module(msg_module), msg_class_name)
        except Exception as e:
            rospy.logerr(str(e))
            return None

    if os.environ.get("ROS_VERSION") == "2":
        def get_topic_qos(self, topic_name: str) -> QoSProfile:
            """!
            Given a topic name, get the QoS profile with which it is being published
            @param topic_name (str) the topic name
            @return QosProfile the qos profile with which the topic is published. If no publishers exist
            for the given topic, it returns the sensor data QoS. returns None in case ROS1 is being used
            """
            if rospy.__name__ == "rospy2":
                topic_info = rospy._node.get_publishers_info_by_topic(topic_name=topic_name)
                if len(topic_info):
                    if topic_info[0].qos_profile.history == HistoryPolicy.UNKNOWN:
                        topic_info[0].qos_profile.history = HistoryPolicy.KEEP_LAST
                    return topic_info[0].qos_profile
                else:
                    rospy.logwarn(f"No publishers available for topic {topic_name}. Returning sensor data QoS")
                    return QoSProfile(
                            depth=10,
                            reliability=QoSReliabilityPolicy.BEST_EFFORT,
                            # reliability=QoSReliabilityPolicy.RELIABLE,
                            durability=QoSDurabilityPolicy.VOLATILE,
                            # durability=QoSDurabilityPolicy.TRANSIENT_LOCAL,
                        )
            else:
                rospy.logwarn("QoS profiles are only used in ROS2")
                return None

    def pingpong_loop(self):
        """
        Loop to send pings to all active sockets every 5 seconds.
        """
        while True:
            time.sleep(5)

            if self.event_loop is None:
                continue
            try:
                self.event_loop.add_callback(ROSBoardSocketHandler.send_pings)
            except Exception as e:
                rospy.logwarn(str(e))
                traceback.print_exc()

    def sync_subs_loop(self):
        """
        Periodically calls self.sync_subs(). Intended to be run in a thread.
        """
        while True:
            time.sleep(1)
            self.sync_subs()

    def sync_subs(self):
        """
        Looks at self.remote_subs and makes sure local subscribers exist to match them.
        Also cleans up unused local subscribers for which there are no remote subs interested in them.
        """

        # Acquire lock since either sync_subs_loop or websocket may call this function (from different threads)
        self.lock.acquire()

        try:
            # all topics and their types as strings e.g. {"/foo": "std_msgs/String", "/bar": "std_msgs/Int32"}
            self.all_topics = {}

            for topic_tuple in rospy.get_published_topics():
                topic_name = topic_tuple[0]
                topic_type = topic_tuple[1]
                if type(topic_type) is list:
                    topic_type = topic_type[0] # ROS2
                self.all_topics[topic_name] = topic_type

            self.event_loop.add_callback(
                ROSBoardSocketHandler.broadcast,
                [ROSBoardSocketHandler.MSG_TOPICS, self.all_topics ]
            )

            for topic_name in self.remote_subs:
                if len(self.remote_subs[topic_name]) == 0:
                    continue

                # remote sub special (non-ros) topic: _dmesg
                # handle it separately here
                if topic_name == "_dmesg":
                    if topic_name not in self.local_subs:
                        rospy.loginfo("Subscribing to dmesg [non-ros]")
                        self.local_subs[topic_name] = DMesgSubscriber(self.on_dmesg)
                    continue

                if topic_name == "_system_stats":
                    if topic_name not in self.local_subs:
                        rospy.loginfo("Subscribing to _system_stats [non-ros]")
                        self.local_subs[topic_name] = SystemStatsSubscriber(self.on_system_stats)
                    continue

                if topic_name == "_top":
                    if topic_name not in self.local_subs:
                        rospy.loginfo("Subscribing to _top [non-ros]")
                        self.local_subs[topic_name] = ProcessesSubscriber(self.on_top)
                    continue

                # check if remote sub request is not actually a ROS topic before proceeding
                if topic_name not in self.all_topics:
                    rospy.logwarn("warning: topic %s not found" % topic_name)
                    continue

                # if the local subscriber doesn't exist for the remote sub, create it
                if topic_name not in self.local_subs:
                    topic_type = self.all_topics[topic_name]
                    msg_class = self.get_msg_class(topic_type)

                    if msg_class is None:
                        # invalid message type or custom message package not source-bashed
                        # put a dummy subscriber in to avoid returning to this again.
                        # user needs to re-run rosboard with the custom message files sourced.
                        self.local_subs[topic_name] = DummySubscriber()
                        self.event_loop.add_callback(
                            ROSBoardSocketHandler.broadcast,
                            [
                                ROSBoardSocketHandler.MSG_MSG,
                                {
                                    "_topic_name": topic_name, # special non-ros topics start with _
                                    "_topic_type": topic_type,
                                    "_error": "Could not load message type '%s'. Are the .msg files for it source-bashed?" % topic_type,
                                },
                            ]
                        )
                        continue

                    self.last_data_times_by_topic[topic_name] = 0.0

                    rospy.loginfo("Subscribing to %s" % topic_name)

                    kwargs = {}
                    if rospy.__name__ == "rospy2":
                        # In ros2 we also can pass QoS parameters to the subscriber.
                        # To avoid incompatibilities we subscribe using the same Qos
                        # of the topic's publishers
                        kwargs = {"qos": self.get_topic_qos(topic_name)}
                    self.local_subs[topic_name] = rospy.Subscriber(
                        topic_name,
                        self.get_msg_class(topic_type),
                        self.on_ros_msg,
                        callback_args = (topic_name, topic_type),
                        **kwargs
                    )

            # clean up local subscribers for which remote clients have lost interest
            for topic_name in list(self.local_subs.keys()):
                if topic_name not in self.remote_subs or \
                    len(self.remote_subs[topic_name]) == 0:
                        rospy.loginfo("Unsubscribing from %s" % topic_name)
                        self.local_subs[topic_name].unregister()
                        del(self.local_subs[topic_name])

        except Exception as e:
            rospy.logwarn(str(e))
            traceback.print_exc()

        self.lock.release()

    def on_system_stats(self, system_stats):
        """
        system stats received. send it off to the client as a "fake" ROS message (which could at some point be a real ROS message)
        """
        if self.event_loop is None:
            return

        msg_dict = {
            "_topic_name": "_system_stats", # special non-ros topics start with _
            "_topic_type": "rosboard_msgs/msg/SystemStats",
        }

        for key, value in system_stats.items():
            msg_dict[key] = value

        self.event_loop.add_callback(
            ROSBoardSocketHandler.broadcast,
            [
                ROSBoardSocketHandler.MSG_MSG,
                msg_dict
            ]
        )

    def on_top(self, processes):
        """
        processes list received. send it off to the client as a "fake" ROS message (which could at some point be a real ROS message)
        """
        if self.event_loop is None:
            return

        self.event_loop.add_callback(
            ROSBoardSocketHandler.broadcast,
            [
                ROSBoardSocketHandler.MSG_MSG,
                {
                    "_topic_name": "_top", # special non-ros topics start with _
                    "_topic_type": "rosboard_msgs/msg/ProcessList",
                    "processes": processes,
                },
            ]
        )

    def on_dmesg(self, text):
        """
        dmesg log received. make it look like a rcl_interfaces/msg/Log and send it off
        """
        if self.event_loop is None:
            return

        self.event_loop.add_callback(
            ROSBoardSocketHandler.broadcast,
            [
                ROSBoardSocketHandler.MSG_MSG,
                {
                    "_topic_name": "_dmesg", # special non-ros topics start with _
                    "_topic_type": "rcl_interfaces/msg/Log",
                    "msg": text,
                },
            ]
        )

    def on_ros_msg(self, msg, topic_info):
        """
        ROS messaged received (any topic or type).
        """
        topic_name, topic_type = topic_info
        t = time.time()
        if t - self.last_data_times_by_topic.get(topic_name, 0) < self.update_intervals_by_topic[topic_name] - 1e-4:
            return

        if self.event_loop is None:
            return

        # convert ROS message into a dict and get it ready for serialization
        ros_msg_dict = ros2dict(msg)

        # add metadata
        ros_msg_dict["_topic_name"] = topic_name
        ros_msg_dict["_topic_type"] = topic_type
        ros_msg_dict["_time"] = time.time() * 1000

        # log last time we received data on this topic
        self.last_data_times_by_topic[topic_name] = t

        # broadcast it to the listeners that care
        self.event_loop.add_callback(
            ROSBoardSocketHandler.broadcast,
            [ROSBoardSocketHandler.MSG_MSG, ros_msg_dict]
        )

    # ---------- Client publish support ----------
    def _dict_to_ros_msg(self, msg_class, data):
        """Recursively fill a ROS message instance from a plain dict."""
        msg = msg_class()
        for field_name in data:
            if not hasattr(msg, field_name):
                continue
            value = data[field_name]
            attr = getattr(msg, field_name)
            # Primitive
            if isinstance(attr, (int, float, bool, str)) or attr is None:
                try:
                    setattr(msg, field_name, value)
                except Exception:
                    pass
            # ROS time special-case
            elif self._is_time_field(attr):
                self._fill_time_field(attr, value)
            # ROS message (has __slots__ or get_fields_and_field_types)
            elif hasattr(attr, "__slots__") or hasattr(attr, "get_fields_and_field_types"):
                sub_msg = self._dict_to_submsg(attr, value)
                setattr(msg, field_name, sub_msg)
            # List
            elif isinstance(attr, list):
                # Determine element type from message metadata
                elem_type = self._get_field_type_string(msg, msg_class, field_name)
                out_list = []
                if isinstance(value, list):
                    if elem_type and elem_type.endswith('[]'):
                        base = elem_type[:-2]
                        # normalize ros1 "pkg/Type" → "pkg/msg/Type"
                        if '/msg/' not in base and base.count('/') == 1:
                            pkg, typ = base.split('/')
                            base = f"{pkg}/msg/{typ}"
                        # Primitive arrays
                        if base in ( 'float32', 'float64', 'int8', 'uint8', 'int16', 'uint16', 'int32', 'uint32', 'int64', 'uint64', 'bool', 'string' ):
                            out_list = value
                        else:
                            # Message array
                            sub_class = self.get_msg_class(base)
                            if sub_class is not None:
                                out_list = [ self._dict_to_ros_msg(sub_class, v if isinstance(v, dict) else {}) for v in value ]
                            else:
                                out_list = value
                    else:
                        out_list = value
                try:
                    setattr(msg, field_name, out_list)
                except Exception:
                    pass
            else:
                try:
                    setattr(msg, field_name, value)
                except Exception:
                    pass
        return msg

    def _is_time_field(self, exemplar):
        return hasattr(exemplar, 'sec') or hasattr(exemplar, 'nanosec') or \
               hasattr(exemplar, 'secs') or hasattr(exemplar, 'nsecs')

    def _fill_time_field(self, exemplar, data):
        try:
            sec = data.get('sec', data.get('secs', 0)) if isinstance(data, dict) else 0
            nsec = data.get('nanosec', data.get('nsecs', data.get('nsec', 0))) if isinstance(data, dict) else 0
            if hasattr(exemplar, 'sec'):
                exemplar.sec = int(sec)
            if hasattr(exemplar, 'secs'):
                exemplar.secs = int(sec)
            if hasattr(exemplar, 'nanosec'):
                exemplar.nanosec = int(nsec)
            if hasattr(exemplar, 'nsecs'):
                exemplar.nsecs = int(nsec)
        except Exception:
            pass

    def _dict_to_submsg(self, exemplar, data):
        # Handle builtin_interfaces/Time or rospy.Time specially
        if self._is_time_field(exemplar):
            self._fill_time_field(exemplar, data if isinstance(data, dict) else {})
            return exemplar
        sub = exemplar.__class__()
        for k, v in (data or {}).items():
            try:
                current = getattr(sub, k)
            except Exception:
                continue
            if self._is_time_field(current):
                self._fill_time_field(current, v if isinstance(v, dict) else {})
                setattr(sub, k, current)
            elif hasattr(current, "__slots__") or hasattr(current, "get_fields_and_field_types"):
                setattr(sub, k, self._dict_to_submsg(current, v))
            else:
                try:
                    setattr(sub, k, v)
                except Exception:
                    pass
        return sub

    def _get_field_type_string(self, msg_instance, msg_class, field_name):
        # ROS2: mapping name->type string e.g. 'geometry_msgs/msg/PoseStamped[]'
        try:
            if hasattr(msg_instance, 'get_fields_and_field_types'):
                mapping = msg_instance.get_fields_and_field_types()
                return mapping.get(field_name)
        except Exception:
            pass
        # ROS1: use _slot_types list aligned with __slots__
        try:
            if hasattr(msg_class, '__slots__') and hasattr(msg_class, '_slot_types'):
                slots = getattr(msg_class, '__slots__')
                types = getattr(msg_class, '_slot_types')
                if field_name in slots:
                    idx = list(slots).index(field_name)
                    return types[idx]
        except Exception:
            pass
        return None

    def handle_publish(self, topic_name, topic_type, msg_obj):
        msg_class = self.get_msg_class(topic_type)
        if msg_class is None:
            self.logerr(f"Publish failed: cannot resolve message type {topic_type}")
            return
        try:
            msg = self._dict_to_ros_msg(msg_class, msg_obj)
            # Ensure header.stamp is set to now to satisfy both ROS1 (secs/nsecs) and ROS2 (sec/nanosec)
            try:
                if hasattr(msg, 'header') and msg.header is not None:
                    if os.environ.get('ROS_VERSION') == '1':
                        msg.header.stamp = rospy.Time.now()
                    else:
                        now = time.time()
                        sec = int(now)
                        nsec = int((now - sec) * 1e9)
                        if hasattr(msg.header.stamp, 'sec'):
                            msg.header.stamp.sec = sec
                        if hasattr(msg.header.stamp, 'nanosec'):
                            msg.header.stamp.nanosec = nsec
                        if hasattr(msg.header.stamp, 'nanosecs'):
                            msg.header.stamp.nanosecs = nsec
            except Exception as _e:
                self.logwarn(f"Could not set header.stamp: {_e}")
            if topic_name not in self.local_pubs:
                # latched by default in ROS1; in ROS2 there is no latch, just create a publisher
                self.local_pubs[topic_name] = rospy.Publisher(topic_name, msg_class, queue_size=1, latch=True) if rospy.__name__ != "rospy2" else rospy.Publisher(topic_name, msg_class, qos=self.get_topic_qos(topic_name))
                # allow some time for publisher to register
                time.sleep(0.05)
            self.local_pubs[topic_name].publish(msg)
        except Exception as e:
            self.logerr(f"Error publishing to {topic_name}: {e}")


def main(args=None):
    ROSBoardNode().start()

if __name__ == '__main__':
    main()
