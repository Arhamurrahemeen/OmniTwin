# TwinLab hardware node — ESP32, ESP-IDF 6.x
# Reads MPU6050 (accel/vibration) + DHT22 (temp/humidity), publishes to the
# TwinLab MQTT contract:  twinlab/device/<DEVICE_ID>/sensor/<sensor>
cmake_minimum_required(VERSION 3.22.1)

include($ENV{IDF_PATH}/tools/cmake/project.cmake)

idf_build_set_property(MINIMAL_BUILD ON)
project(twinlab_node_v1)
