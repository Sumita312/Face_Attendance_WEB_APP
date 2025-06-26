from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import cv2
import numpy as np
import os
from datetime import datetime
import json
import logging

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}}) # Enable CORS for all origins and routesc
# --- Configuration ---
KNOWN_FACES_TRAINING_DIR = "known_faces_images" # Directory for subfolders of training images
ATTENDANCE_LOG_FILE = "attendance_log_lbph.csv" # CSV file to log attendance
LBPH_MODEL_FILE = "lbph_face_model.yml" # File to save/load the trained LBPH model
LABELS_MAP_FILE = LBPH_MODEL_FILE + "_labels.npy" # Companion file for labels map

# Ensure directories exist
os.makedirs(KNOWN_FACES_TRAINING_DIR, exist_ok=True)

# --- Global Variables for Backend ---
face_recognizer = cv2.face.LBPHFaceRecognizer_create()
labels_map = {} # {numerical_id: {'name': 'Name', 'roll_no': 'RollNo'}}
next_label_id = 0
attendance_logged_today = {} # Stores {'Name_RollNo': datetime_object} to manage attendance logging frequency
min_log_interval_seconds = 10 # Minimum time (seconds) between logging attendance for the same person

# --- OpenCV Face Detector (Haar Cascade) ---
# This path is relative to the OpenCV installation, and needs to be present
HAARCASCADE_PATH = cv2.data.haarcascades + 'haarcascade_frontalface_default.xml'
face_detector = cv2.CascadeClassifier(HAARCASCADE_PATH)

if not os.path.exists(HAARCASCADE_PATH) or face_detector.empty():
    logging.error(f"FATAL: Haar Cascade XML file not found or could not be loaded from {HAARCASCADE_PATH}.")
    logging.error("Please ensure your opencv-contrib-python installation is complete and includes the 'data' directory.")
    # Exit or raise error, as face detection is core functionality
    # For a web app, we'll let it run but log the error prominently.

def load_or_train_model():
    """
    Loads an existing LBPH model if available, otherwise trains a new one
    using images from KNOWN_FACES_TRAINING_DIR.
    """
    global labels_map, next_label_id
    
    if os.path.exists(LBPH_MODEL_FILE) and os.path.exists(LABELS_MAP_FILE):
        try:
            face_recognizer.read(LBPH_MODEL_FILE)
            loaded_labels_data = np.load(LABELS_MAP_FILE, allow_pickle=True).item()
            labels_map = {int(k): v for k, v in loaded_labels_data.items()} # Ensure keys are int
            next_label_id = max(labels_map.keys()) + 1 if labels_map else 0
            logging.info(f"Loaded existing LBPH model and labels. Next label ID: {next_label_id}")
            return True
        except cv2.error as e:
            logging.error(f"Error loading LBPH model: {e}. Model might be corrupted. Retraining...")
            return train_model()
        except Exception as e:
            logging.error(f"An unexpected error occurred loading model or labels: {e}. Retraining...")
            return train_model()
    else:
        logging.info("No existing LBPH model or labels found. Attempting to train new model...")
        return train_model()

def train_model():
    """
    Collects face images and labels from KNOWN_FACES_TRAINING_DIR
    and trains the LBPH face recognizer.
    """
    global labels_map, next_label_id
    images = []
    labels = []
    current_id = next_label_id # Start from the last assigned ID or 0

    logging.info(f"Scanning '{KNOWN_FACES_TRAINING_DIR}' for training images...")
    if not os.path.exists(KNOWN_FACES_TRAINING_DIR):
        logging.error(f"Training directory '{KNOWN_FACES_TRAINING_DIR}' not found. Please create it and add face images in subfolders.")
        return False

    if face_detector.empty(): # Check if detector was loaded successfully at startup
        logging.error("Face detector (Haar Cascade) not loaded. Cannot train model.")
        return False

    for root, dirs, files in os.walk(KNOWN_FACES_TRAINING_DIR):
        dirs.sort() # Sort directories for consistent labeling
        for dir_name in dirs:
            parts = dir_name.split('_')
            name = parts[0].replace('-', ' ').title()
            roll_no = parts[1] if len(parts) > 1 else ""

            found_label = None
            for label_id, info in labels_map.items():
                if info['name'] == name and info['roll_no'] == roll_no:
                    found_label = label_id
                    break
            
            if found_label is None:
                label_id = current_id
                labels_map[label_id] = {'name': name, 'roll_no': roll_no}
                current_id += 1
            else:
                label_id = found_label
            
            logging.info(f"  Processing: {name} ({roll_no}) -> Label ID: {label_id}")

            path = os.path.join(root, dir_name)
            for file_name in os.listdir(path):
                if file_name.lower().endswith(('.png', '.jpg', '.jpeg', '.gif')):
                    image_path = os.path.join(path, file_name)
                    img = cv2.imread(image_path, cv2.IMREAD_GRAYSCALE) 
                    if img is not None:
                        detected_faces = face_detector.detectMultiScale(img, scaleFactor=1.1, minNeighbors=5)
                        
                        if len(detected_faces) == 1:
                            (x, y, w, h) = detected_faces[0]
                            face_roi = cv2.resize(img[y:y+h, x:x+w], (100, 100)) # Standardize size
                            images.append(face_roi)
                            labels.append(label_id)
                        else:
                            logging.warning(f"    Skipping '{file_name}': Found {len(detected_faces)} faces (expected 1).")
                    else:
                        logging.warning(f"    Warning: Could not read image '{file_name}'.")

    if not images:
        logging.warning("No valid faces found for training. Ensure images are in subfolders and contain clear faces.")
        return False

    logging.info(f"Training LBPH model with {len(images)} images and {len(set(labels))} unique persons...")
    try:
        face_recognizer.train(images, np.array(labels))
        face_recognizer.write(LBPH_MODEL_FILE)
        np.save(LABELS_MAP_FILE, labels_map)
        next_label_id = current_id
        logging.info("LBPH model training complete and saved.")
        return True
    except Exception as e:
        logging.error(f"Error during model training: {e}")
        return False

def log_attendance(name, roll_no):
    """
    Logs the attendance to a CSV, preventing spamming by logging once per interval.
    """
    current_time_dt = datetime.now()
    today_date = current_time_dt.strftime("%Y-%m-%d")
    log_key = f"{name}_{roll_no}_{today_date}"

    last_logged_dt = attendance_logged_today.get(log_key)
    if last_logged_dt is None or \
       (current_time_dt - last_logged_dt).total_seconds() > min_log_interval_seconds:
        
        log_entry = f"{today_date},{current_time_dt.strftime('%H:%M:%S')},{name},{roll_no}\n"
        try:
            if not os.path.exists(ATTENDANCE_LOG_FILE):
                with open(ATTENDANCE_LOG_FILE, "w") as f_header:
                    f_header.write("Date,Time,Name,Roll_Number\n")
            
            with open(ATTENDANCE_LOG_FILE, "a") as f:
                f.write(log_entry)
            logging.info(f"[ATTENDANCE MARKED] Name: {name}, Roll No: {roll_no} at {current_time_dt.strftime('%H:%M:%S')}")
            attendance_logged_today[log_key] = current_time_dt
            return True # Logged successfully
        except Exception as e:
            logging.error(f"Error writing to attendance log: {e}")
            return False
    return False # Not logged due to interval

# --- Flask Routes ---

@app.route('/')
def index():
    return "Face Recognition Backend is running. Access the React app frontend."

@app.route('/train', methods=['POST'])
def train_model_endpoint():
    logging.info("Received request to train model.")
    if train_model():
        return jsonify({"message": "Model training complete!"}), 200
    else:
        return jsonify({"error": "Model training failed. Check backend logs for details."}), 500

@app.route('/register', methods=['POST'])
def register_face():
    logging.info("Received request to register face.")
    name = request.form.get('name')
    roll_no = request.form.get('roll_no')
    image_file = request.files.get('image')

    if not name or not roll_no or not image_file:
        return jsonify({"error": "Name, Roll Number, and Image are required."}), 400
    
    # Clean name and roll_no for folder naming
    clean_name = "".join(c for c in name if c.isalnum() or c == ' ').strip().replace(' ', '_')
    clean_roll_no = "".join(c for c in roll_no if c.isalnum() or c == '_').strip()
    
    person_dir = os.path.join(KNOWN_FACES_TRAINING_DIR, f"{clean_name}_{clean_roll_no}")
    os.makedirs(person_dir, exist_ok=True)

    img_path = os.path.join(person_dir, f"{clean_name}_{clean_roll_no}_{datetime.now().strftime('%Y%m%d%H%M%S')}.jpg")
    try:
        img_np = np.frombuffer(image_file.read(), np.uint8)
        img = cv2.imdecode(img_np, cv2.IMREAD_COLOR)
        if img is None:
            logging.error("Could not decode image received for registration.")
            return jsonify({"error": "Invalid image file provided."}), 400
        
        cv2.imwrite(img_path, img)
        logging.info(f"Saved registration image for {name} to {img_path}")
        
        # After saving, retrain the model to include the new face
        if train_model():
            return jsonify({"message": f"Successfully registered {name} ({roll_no}) and retrained model."}), 200
        else:
            return jsonify({"error": f"Registered image for {name}, but failed to retrain model. Check backend logs."}), 500

    except Exception as e:
        logging.error(f"Error during registration: {e}")
        return jsonify({"error": f"An error occurred during registration: {e}"}), 500

@app.route('/scan_image', methods=['POST'])
def scan_image_endpoint():
    logging.info("Received request to scan image.")
    image_file = request.files.get('image')

    if not image_file:
        return jsonify({"error": "Image file is required for scanning."}), 400

    if face_detector.empty():
        return jsonify({"error": "Face detection system not initialized on backend. Check server logs."}), 500

    # Ensure model is loaded before scanning
    if not labels_map:
        if not load_or_train_model(): # Try to load/train if not already
            return jsonify({"error": "Face recognition model not available or training failed."}), 500

    try:
        img_np = np.frombuffer(image_file.read(), np.uint8)
        frame = cv2.imdecode(img_np, cv2.IMREAD_COLOR)
        
        if frame is None:
            logging.error("Could not decode image received for scanning.")
            return jsonify({"error": "Invalid image file provided."}), 400

        gray_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        faces = face_detector.detectMultiScale(gray_frame, scaleFactor=1.1, minNeighbors=5, minSize=(30, 30))

        if not faces.any(): # Check if any faces were detected
            return jsonify({"message": "No face detected in the uploaded image."}), 200

        results = []
        for (x, y, w, h) in faces:
            face_roi = cv2.resize(gray_frame[y:y+h, x:x+w], (100, 100))
            
            label, confidence = face_recognizer.predict(face_roi)
            
            name = "Unknown"
            roll_no = ""
            recognition_threshold = 80 # Adjust as needed

            if confidence < recognition_threshold and label in labels_map:
                person_info = labels_map[label]
                name = person_info['name']
                roll_no = person_info['roll_no']
                log_attendance(name, roll_no) # Log attendance for recognized person
                results.append(f"Recognized: {name} (Roll: {roll_no}). Attendance Marked.")
            else:
                results.append(f"Detected an Unknown face (Confidence: {int(confidence)}). Access Denied.")
        
        return jsonify({"message": " ".join(results)}), 200

    except Exception as e:
        logging.error(f"Error during image scan: {e}")
        return jsonify({"error": f"An error occurred during scanning: {e}"}), 500

@app.route('/get_log', methods=['GET'])
def get_log():
    
    print("DEBUG: Entered get_log route function.") # <-- Add this line
    
    logging.info("Received request to get attendance log.")
    if os.path.exists(ATTENDANCE_LOG_FILE):
        try:
            with open(ATTENDANCE_LOG_FILE, "r") as f:
                log_content = f.read()
            return log_content, 200, {'Content-Type': 'text/csv'}
        except Exception as e:
            logging.error(f"Error reading attendance log: {e}")
            return "Error reading log file.", 500
    else:
        return "Attendance log file not found.", 404

# Initial model load/train when the Flask app starts
with app.app_context(): # Ensure app context is available for initial load
    load_or_train_model()
    logging.info("Flask app initialized. Model loaded or trained on startup.")

if __name__ == '__main__':
    app.run(debug=True, host='127.0.0.1', port=5000)
