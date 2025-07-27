#!/bin/bash
# Daily cleanup script for HLS4U Stream
cd /home/hls4u-stream/htdocs/stream.hls4u.xyz/scripts
mariadb -u hls4u-stream -pN72kySNBgREd9nNCnu3m hls4u-stream < cleanup.sql
echo "$(date): Activity logs cleaned" >> ../logs/cleanup.log
