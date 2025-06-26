import React, { useState, useEffect, useRef } from 'react'; // Added useRef
import { Camera, UploadCloud, UserPlus, FileText, XCircle, CheckCircle, AlertCircle, RefreshCw, Webcam } from 'lucide-react'; // Removed unused Play, Pause, Download icons

const App = () => {
    const [mode, setMode] = useState('home'); // 'home', 'register', 'scan', 'log'
    const [name, setName] = useState('');
    const [rollNo, setRollNo] = useState('');
    const [registerImage, setRegisterImage] = useState(null);
    const [message, setMessage] = useState({ type: '', text: '' }); // {type: 'success', 'error', 'info', text: '...'}
    const [loading, setLoading] = useState(false);
    const [attendanceLog, setAttendanceLog] = useState('');

    // Webcam states
    const videoRef = useRef(null);
    const canvasRef = useRef(null);
    const [webcamStream, setWebcamStream] = useState(null);
    const [capturedImageBlob, setCapturedImageBlob] = useState(null); // Stores the captured image as a Blob

    const API_BASE_URL = 'http://127.0.0.1:5000'; // Make sure this matches your Flask backend URL

    useEffect(() => {
        if (message.text) {
            const timer = setTimeout(() => {
                setMessage({ type: '', text: '' });
            }, 5000); // Clear message after 5 seconds
            return () => clearTimeout(timer);
        }
    }, [message]);

    // Effect to manage webcam stream when entering/exiting scan mode
    useEffect(() => {
        if (mode === 'scan') {
            startWebcam();
        } else {
            stopWebcam();
            setCapturedImageBlob(null); // Clear captured image when leaving scan mode
        }
        // Cleanup function for when component unmounts or mode changes
        return () => {
            stopWebcam();
        };
    }, [mode]);

    const startWebcam = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true });
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
                videoRef.current.play();
                setWebcamStream(stream);
                setMessage({ type: 'info', text: 'Webcam started. Capture a photo for attendance.' });
            }
        } catch (err) {
            setMessage({ type: 'error', text: `Failed to start webcam: ${err.name} - ${err.message}. Please ensure camera access is granted.` });
            console.error("Error accessing webcam:", err);
        }
    };

    const stopWebcam = () => {
        if (webcamStream) {
            webcamStream.getTracks().forEach(track => track.stop());
            setWebcamStream(null);
            if (videoRef.current) {
                videoRef.current.srcObject = null;
            }
        }
    };

    const capturePhoto = () => {
        if (videoRef.current && canvasRef.current) {
            const video = videoRef.current;
            const canvas = canvasRef.current;
            const context = canvas.getContext('2d');

            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            context.drawImage(video, 0, 0, canvas.width, canvas.height);

            canvas.toBlob((blob) => {
                setCapturedImageBlob(blob);
                setMessage({ type: 'success', text: 'Photo captured! Click "Perform Scan" to send to backend.' });
            }, 'image/jpeg', 0.9); // Capture as JPEG with quality 0.9
        } else {
            setMessage({ type: 'error', text: 'Webcam not ready or canvas not accessible for photo capture.' });
        }
    };

    const handleFileChange = (e, setImage) => {
        const file = e.target.files[0];
        if (file) {
            setImage(file);
        }
    };

    const handleRegister = async () => {
        if (!name || !rollNo || !registerImage) {
            setMessage({ type: 'error', text: 'Please fill in all fields and select an image.' });
            return;
        }

        setLoading(true);
        setMessage({ type: 'info', text: 'Registering face... This may take a moment.' });

        const formData = new FormData();
        formData.append('name', name);
        formData.append('roll_no', rollNo);
        formData.append('image', registerImage);

        try {
            const response = await fetch(`${API_BASE_URL}/register`, {
                method: 'POST',
                body: formData,
            });
            const data = await response.json();

            if (response.ok) {
                setMessage({ type: 'success', text: data.message });
                setName('');
                setRollNo('');
                setRegisterImage(null);
            } else {
                setMessage({ type: 'error', text: data.error || 'Registration failed.' });
            }
        } catch (error) {
            setMessage({ type: 'error', text: `Network error during registration: ${error.message}` });
        } finally {
            setLoading(false);
        }
    };

    const handleScan = async () => {
        if (!capturedImageBlob) {
            setMessage({ type: 'error', text: 'Please capture a photo first.' });
            return;
        }

        setLoading(true);
        setMessage({ type: 'info', text: 'Sending captured photo for face recognition...' });

        const formData = new FormData();
        // Give the blob a filename for the backend
        formData.append('image', capturedImageBlob, 'webcam_scan.jpeg'); 

        try {
            const response = await fetch(`${API_BASE_URL}/scan_image`, {
                method: 'POST',
                body: formData,
            });
            const data = await response.json();

            if (response.ok) {
                setMessage({ type: 'success', text: data.message });
            } else {
                setMessage({ type: 'error', text: data.error || 'Scan failed.' });
            }
        } catch (error) {
            setMessage({ type: 'error', text: `Network error during scan: ${error.message}` });
        } finally {
            setLoading(false);
            setCapturedImageBlob(null); // Clear captured image after scan
        }
    };

    const handleTrainModel = async () => {
        setLoading(true);
        setMessage({ type: 'info', text: 'Training model... This can take some time depending on your dataset.' });

        try {
            const response = await fetch(`${API_BASE_URL}/train`, {
                method: 'POST', // Use POST as it's an action
            });
            const data = await response.json();

            if (response.ok) {
                setMessage({ type: 'success', text: data.message });
            } else {
                setMessage({ type: 'error', text: data.error || 'Model training failed.' });
            }
        } catch (error) {
            setMessage({ type: 'error', text: `Network error during training: ${error.message}` });
        } finally {
            setLoading(false);
        }
    };

    const handleViewLog = async () => {
        setLoading(true);
        setMessage({ type: 'info', text: 'Fetching attendance log...' });

        try {
            const response = await fetch(`${API_BASE_URL}/get_log`);
            const data = await response.text(); // Log is plain text/CSV

            if (response.ok) {
                setAttendanceLog(data);
                setMode('log'); // Change mode to display log
                setMessage({ type: 'success', text: 'Attendance log loaded.' });
            } else {
                setMessage({ type: 'error', text: `Failed to fetch log: ${data || response.statusText}` });
            }
        } catch (error) {
            setMessage({ type: 'error', text: `Network error fetching log: ${error.message}` });
        } finally {
            setLoading(false);
        }
    };

    const getMessageIcon = (type) => {
        switch (type) {
            case 'success': return <CheckCircle size={20} className="inline-block mr-2" />;
            case 'error': return <XCircle size={20} className="inline-block mr-2" />;
            case 'info': return <AlertCircle size={20} className="inline-block mr-2" />;
            default: return null;
        }
    };

    const commonButtonClasses = "w-full max-w-sm text-white font-bold py-3 px-6 rounded-lg flex items-center justify-center transition duration-300 transform hover:scale-105 shadow-md hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-offset-2";

    const renderHome = () => (
        <div className="flex flex-col items-center justify-center p-6 space-y-4">
            <h2 className="text-3xl font-bold text-gray-800 mb-6 drop-shadow-sm">Attendance System Menu</h2>
            <button
                className={`${commonButtonClasses} bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 focus:ring-blue-500`}
                onClick={() => setMode('register')}
            >
                <UserPlus size={24} className="mr-3" /> Register New Face
            </button>
            <button
                className={`${commonButtonClasses} bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 focus:ring-green-500`}
                onClick={() => setMode('scan')}
            >
                <Camera size={24} className="mr-3" /> Scan Face for Attendance
            </button>
            <button
                className={`${commonButtonClasses} bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-700 hover:to-purple-800 focus:ring-purple-500`}
                onClick={handleTrainModel}
                disabled={loading}
            >
                <RefreshCw size={24} className="mr-3" /> {loading && message.type === 'info' && message.text.includes('Training') ? 'Training...' : 'Train/Retrain Model'}
            </button>
             <button
                className={`${commonButtonClasses} bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-700 hover:to-indigo-800 focus:ring-indigo-500`}
                onClick={handleViewLog}
                disabled={loading}
            >
                <FileText size={24} className="mr-3" /> View Attendance Log
            </button>
        </div>
    );

    const renderRegister = () => (
        <div className="p-6">
            <h2 className="text-3xl font-bold text-gray-800 mb-6 text-center drop-shadow-sm">Register New Face</h2>
            <div className="space-y-4 max-w-md mx-auto bg-white p-6 rounded-2xl shadow-xl border border-gray-200">
                <div>
                    <label htmlFor="name" className="block text-sm font-semibold text-gray-700 mb-1">Name</label>
                    <input
                        type="text"
                        id="name"
                        className="mt-1 block w-full px-4 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 transition duration-150"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="John Doe"
                    />
                </div>
                <div>
                    <label htmlFor="rollNo" className="block text-sm font-semibold text-gray-700 mb-1">Roll Number</label>
                    <input
                        type="text"
                        id="rollNo"
                        className="mt-1 block w-full px-4 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 transition duration-150"
                        value={rollNo}
                        onChange={(e) => setRollNo(e.target.value)}
                        placeholder="12345"
                    />
                </div>
                <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Select Image (e.g., a clear photo of face)</label>
                    <input
                        type="file"
                        accept="image/*"
                        className="mt-1 block w-full text-sm text-gray-600
                                file:mr-4 file:py-2 file:px-4
                                file:rounded-full file:border-0
                                file:text-sm file:font-semibold
                                file:bg-violet-50 file:text-violet-700
                                hover:file:bg-violet-100 cursor-pointer"
                        onChange={(e) => handleFileChange(e, setRegisterImage)}
                    />
                    {registerImage && (
                        <p className="mt-2 text-sm text-gray-600">Selected: <span className="font-medium text-blue-700">{registerImage.name}</span></p>
                    )}
                </div>
                <button
                    className="w-full bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white font-bold py-2 px-4 rounded-lg flex items-center justify-center transition duration-300 shadow-md hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                    onClick={handleRegister}
                    disabled={loading}
                >
                    <UploadCloud size={20} className="mr-2" /> {loading ? 'Registering...' : 'Register Face'}
                </button>
                 <button
                    className="w-full mt-3 bg-gray-500 hover:bg-gray-600 text-white font-bold py-2 px-4 rounded-lg transition duration-300 shadow-md hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2"
                    onClick={() => setMode('home')}
                >
                    Back to Menu
                </button>
            </div>
        </div>
    );

    const renderScan = () => (
        <div className="p-6">
            <h2 className="text-3xl font-bold text-gray-800 mb-6 text-center drop-shadow-sm">Scan Face for Attendance</h2>
            <div className="space-y-4 max-w-md mx-auto bg-white p-6 rounded-2xl shadow-xl border border-gray-200">
                <p className="text-sm text-gray-600 mb-4 text-center">
                    Look at the camera, click "Capture Photo", then "Perform Scan".
                </p>
                <div className="flex justify-center items-center bg-gray-100 rounded-lg overflow-hidden w-full aspect-video border border-gray-300 shadow-inner">
                    <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover rounded-lg"></video>
                    {/* Hidden canvas for capturing photo */}
                    <canvas ref={canvasRef} style={{ display: 'none' }}></canvas>
                </div>

                <div className="flex justify-center space-x-4">
                    <button
                        className="flex-1 bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-700 hover:to-indigo-800 text-white font-bold py-2 px-4 rounded-lg flex items-center justify-center transition duration-300 shadow-md hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
                        onClick={capturePhoto}
                        disabled={!webcamStream || loading}
                    >
                        <Webcam size={20} className="mr-2" /> Capture Photo
                    </button>
                     {capturedImageBlob && (
                        <button
                            className="flex-1 bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 text-white font-bold py-2 px-4 rounded-lg flex items-center justify-center transition duration-300 shadow-md hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2"
                            onClick={handleScan}
                            disabled={loading}
                        >
                            <Camera size={20} className="mr-2" /> {loading ? 'Scanning...' : 'Perform Scan'}
                        </button>
                    )}
                </div>
                {capturedImageBlob && (
                    <div className="mt-4 text-center text-sm text-gray-700">
                        Photo captured. Ready to scan.
                    </div>
                )}
                <button
                    className="w-full mt-3 bg-gray-500 hover:bg-gray-600 text-white font-bold py-2 px-4 rounded-lg transition duration-300 shadow-md hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2"
                    onClick={() => setMode('home')}
                >
                    Back to Menu
                </button>
            </div>
        </div>
    );

    const renderLog = () => (
        <div className="p-6">
            <h2 className="text-3xl font-bold text-gray-800 mb-6 text-center drop-shadow-sm">Attendance Log</h2>
            <div className="max-w-4xl mx-auto bg-white p-6 rounded-2xl shadow-xl border border-gray-200 overflow-x-auto">
                {attendanceLog ? (
                    <pre className="text-sm text-gray-800 bg-gray-100 p-4 rounded-md overflow-x-auto whitespace-pre-wrap font-mono leading-relaxed">
                        {attendanceLog}
                    </pre>
                ) : (
                    <p className="text-gray-600 text-center py-4">No attendance log available yet. Scan a recognized face to create entries.</p>
                )}
                <button
                    className="w-full mt-6 bg-gray-500 hover:bg-gray-600 text-white font-bold py-2 px-4 rounded-lg transition duration-300 shadow-md hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2"
                    onClick={() => setMode('home')}
                >
                    Back to Menu
                </button>
            </div>
        </div>
    );


    return (
        <div className="min-h-screen bg-gradient-to-br from-blue-200 to-purple-400 flex flex-col items-center justify-center p-4 font-sans"> {/* More vibrant gradient */}
            <div className="w-full max-w-2xl bg-white rounded-3xl shadow-2xl p-8 transform transition-all duration-300 ease-in-out border border-gray-100"> {/* Sharper shadow, more rounded */}
                <h1 className="text-4xl font-extrabold text-center text-gray-900 mb-8 tracking-tight drop-shadow-lg">
                    Face Attendance Web System
                </h1>

                {message.text && (
                    <div className={`p-4 mb-6 rounded-lg flex items-center ${
                        message.type === 'success' ? 'bg-green-100 text-green-800 border border-green-200' :
                        message.type === 'error' ? 'bg-red-100 text-red-800 border border-red-200' :
                        'bg-blue-100 text-blue-800 border border-blue-200'
                    } shadow-sm`}>
                        {getMessageIcon(message.type)}
                        <span className="font-medium">{message.text}</span>
                    </div>
                )}

                {loading && (
                    <div className="flex items-center justify-center mb-6 text-blue-600">
                        <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        <span className="font-semibold text-lg">Processing...</span>
                    </div>
                )}

                {mode === 'home' && renderHome()}
                {mode === 'register' && renderRegister()}
                {mode === 'scan' && renderScan()}
                {mode === 'log' && renderLog()}
            </div>
        </div>
    );
};

export default App;
