"""
# I could not believe my eyes when I went to a customer last year and I had to open a ticket and explain why we need to have file cleanup scripts 
# If a sysadmin cannot do this then you should question what atre they doing, it is the most basic and essential task.
# Every day 100s of hours are spent in tickets about this topic and operations incidents , this has to stop guys!
#
# Here is my gift to the IT World , a Free script in Python you can modify. 
# Cheers!  -  Fernando Cabal   - 02 April 2025
"""
import os
import shutil
import gzip
import time
import logging
import sys

def configure_logging(log_file_path):
    """
    Configures logging to write to a specified log file.

    Args:
        log_file_path (str): The path to the log file.
    """
    # Create the directory if it doesn't exist
    log_dir = os.path.dirname(log_file_path)
    if log_dir and not os.path.exists(log_dir):
        os.makedirs(log_dir)

    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(levelname)s - %(message)s',
        handlers=[
            logging.FileHandler(log_file_path),
            logging.StreamHandler(sys.stdout)  # Also log to console
        ]
    )

def get_file_size_mb(file_path):
    """
    Gets the size of a file in megabytes.

    Args:
        file_path (str): The path to the file.

    Returns:
        float: The size of the file in megabytes, or 0 if the file does not exist or an error occurs.
    """
    try:
        if os.path.exists(file_path):
            return os.path.getsize(file_path) / (1024 * 1024)  # Convert bytes to MB
        else:
            logging.warning(f"File not found: {file_path}")
            return 0
    except Exception as e:
        logging.error(f"Error getting file size for {file_path}: {e}")
        return 0

def compress_file(input_file, output_file):
    """
    Compresses a file using gzip.

    Args:
        input_file (str): The path to the input file.
        output_file (str): The path to the output (compressed) file.
    """
    try:
        with open(input_file, 'rb') as infile, gzip.open(output_file, 'wb') as outfile:
            shutil.copyfileobj(infile, outfile)
        logging.info(f"Successfully compressed {input_file} to {output_file}")
        return True
    except Exception as e:
        logging.error(f"Error compressing file {input_file}: {e}")
        return False

def copy_file(src_file, dest_file):
    """
    Copies a file from source to destination.

    Args:
        src_file (str): Path to the source file.
        dest_file (str): Path to the destination file.
    """
    try:
        # Ensure the destination directory exists
        dest_dir = os.path.dirname(dest_file)
        if dest_dir and not os.path.exists(dest_dir):
            os.makedirs(dest_dir)
        shutil.copy2(src_file, dest_file)  # copy with metadata
        logging.info(f"Successfully copied {src_file} to {dest_file}")
        return True
    except Exception as e:
        logging.error(f"Error copying file {src_file} to {dest_file}: {e}")
        return False
    
def delete_file(file_path):
    """
    Deletes a file.

    Args:
        file_path (str): The path to the file to delete.
    """
    try:
        os.remove(file_path)
        logging.info(f"Successfully deleted file: {file_path}")
        return True
    except Exception as e:
        logging.error(f"Error deleting file {file_path}: {e}")
        return False

def process_log_files(dir1, dir2, log_file_path):
    """
    Processes log files in dir1 that are larger than 500MB, copies them to dir2,
    compresses the copy, and deletes the original in dir1.

    Args:
        dir1 (str): The path to the source directory.
        dir2 (str): The path to the destination directory.
        log_file_path (str): Path to the log file.
    """
    configure_logging(log_file_path)
    logging.info(f"Starting log file processing from {dir1} to {dir2}")

    if not os.path.exists(dir1):
        logging.error(f"Source directory does not exist: {dir1}")
        return
    if not os.path.exists(dir2):
        logging.error(f"Destination directory does not exist: {dir2}")
        return

    for filename in os.listdir(dir1):
        src_file = os.path.join(dir1, filename)
        if not os.path.isfile(src_file):
            continue  # Skip directories and non-files

        file_size_mb = get_file_size_mb(src_file)
        if file_size_mb > 500:
            logging.info(f"Found large file: {src_file} ({file_size_mb:.2f} MB)")

            # Create destination filename
            dest_file = os.path.join(dir2, filename)
            compressed_file = dest_file + '.gz'

            # Copy the file
            copy_success = copy_file(src_file, dest_file)

            if copy_success:
                # Compress the copied file
                compress_success = compress_file(dest_file, compressed_file)
                if compress_success:
                    # Delete the original file
                    delete_success = delete_file(dest_file)
                    if delete_success:
                        logging.info(f"Successfully processed {src_file}")
                    else:
                        logging.error(f"Failed to delete original file: {dest_file}")
                else:
                    logging.error(f"Failed to compress file: {dest_file}")
            else:
                logging.error(f"Failed to copy file: {src_file}")
        else:
            logging.info(f"Skipping file: {src_file} ({file_size_mb:.2f} MB) - Size is not greater than 500MB")

    logging.info("Log file processing complete.")

if __name__ == "__main__":
    # Example usage:
    source_directory = '/path/to/your/log/files'  # Replace with your actual source directory
    destination_directory = '/path/to/your/backup/logs'  # Replace with your actual destination directory
    log_file = '/path/to/your/log_rotation.log'  # Replace with your desired log file path
    process_log_files(source_directory, destination_directory, log_file)
