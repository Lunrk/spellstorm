const videoElement = document.getElementById("video");
const canvasElement = document.getElementById("overlay");
const canvasCtx = canvasElement.getContext("2d");
const statusElement = document.getElementById("status");
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");

let camera = null;
let hands = null;

function updateStatus(message) {
  statusElement.textContent = message;
}

function resizeCanvasToVideo() {
  const width = videoElement.videoWidth || 640;
  const height = videoElement.videoHeight || 480;
  canvasElement.width = width;
  canvasElement.height = height;
}

function drawResults(results) {
  resizeCanvasToVideo();

  canvasCtx.save();
  canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
  canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);

  if (results.multiHandLandmarks) {
    for (const landmarks of results.multiHandLandmarks) {
      drawConnectors(canvasCtx, landmarks, HAND_CONNECTIONS, {
        color: "#21d07a",
        lineWidth: 3
      });
      drawLandmarks(canvasCtx, landmarks, {
        color: "#ff5353",
        lineWidth: 1,
        radius: 4
      });
    }
  }

  canvasCtx.restore();
}

function stopCamera() {
  if (camera && typeof camera.stop === "function") {
    camera.stop();
  }

  const stream = videoElement.srcObject;
  if (stream) {
    const tracks = stream.getTracks();
    for (const track of tracks) {
      track.stop();
    }
    videoElement.srcObject = null;
  }

  canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
  startBtn.disabled = false;
  stopBtn.disabled = true;
  updateStatus("Camera stopped");
}

async function startCamera() {
  try {
    startBtn.disabled = true;
    stopBtn.disabled = false;
    updateStatus("Loading hand model...");

    if (!hands) {
      hands = new Hands({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
      });

      hands.setOptions({
        maxNumHands: 2,
        modelComplexity: 1,
        minDetectionConfidence: 0.7,
        minTrackingConfidence: 0.6
      });

      hands.onResults(drawResults);
    }

    camera = new Camera(videoElement, {
      onFrame: async () => {
        await hands.send({ image: videoElement });
      },
      width: 960,
      height: 540
    });

    await camera.start();
    resizeCanvasToVideo();
    updateStatus("Tracking hands...");
  } catch (error) {
    stopCamera();
    updateStatus("Failed to start camera");
    console.error("Could not initialize MediaPipe hands:", error);
  }
}

startBtn.addEventListener("click", () => {
  startCamera();
});

stopBtn.addEventListener("click", () => {
  stopCamera();
});
