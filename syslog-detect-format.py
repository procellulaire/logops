#!/usr/bin/env python
#
# SYSLOG Detector by Fernando Cabal
# Try to detet the format of the syslog v0.1 
# TO DO :  Provie information that can be used to configure SIEM and log analysis tools.
# TO DO :  Add pattern definitions from vendors, try to detect what vendor , application or device did generate the file by using a database with knowledge.

import re
import sys
from datetime import datetime

# Define regex patterns for common syslog formats
RFC3164_PATTERN = re.compile(r'^(<\d+>)?(?P<timestamp>\w{3} \d{1,2} \d{2}:\d{2}:\d{2}) ([\w.-]+) (.+)$')
RFC5424_PATTERN = re.compile(r'^(<\d+>\d )?(?P<timestamp>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{1,6}Z) ([\w.-]+) ([\w.-]+) (\d+) (\[.*?\]|-) (.+)$')


def detect_syslog_format(log_line):
    """Detects the format of a given syslog line and extracts timestamp."""
    match_5424 = RFC5424_PATTERN.match(log_line)
    match_3164 = RFC3164_PATTERN.match(log_line)
    
    if match_5424:
        timestamp = match_5424.group("timestamp")
        try:
            parsed_timestamp = datetime.strptime(timestamp, "%Y-%m-%dT%H:%M:%S.%fZ")
        except ValueError:
            parsed_timestamp = None
        return "RFC 5424 (Structured Data)", timestamp, parsed_timestamp
    
    elif match_3164:
        timestamp = match_3164.group("timestamp")
        try:
            parsed_timestamp = datetime.strptime(timestamp, "%b %d %H:%M:%S")
        except ValueError:
            parsed_timestamp = None
        return "RFC 3164 (Traditional Format)", timestamp, parsed_timestamp
    
    return "Unknown Format", None, None


def analyze_syslog_file(file_path):
    """Reads a syslog file and attempts to determine its format and timestamp."""
    try:
        with open(file_path, 'r', encoding='utf-8') as file:
            for line in file:
                line = line.strip()
                if line:
                    detected_format, timestamp, parsed_timestamp = detect_syslog_format(line)
                    print(f"Detected: {detected_format} -> {line}")
                    if timestamp:
                        print(f"Extracted Timestamp: {timestamp}")
                        print(f"Parsed Timestamp: {parsed_timestamp}")
                    break  # Only analyze the first non-empty line
    except Exception as e:
        print(f"Error reading file: {e}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python detect_syslog_format.py <syslog_file>")
        sys.exit(1)
    
    file_path = sys.argv[1]
    analyze_syslog_file(file_path)
