const videoElement = document.getElementById("video");
const canvasElement = document.getElementById("overlay");
const canvasCtx = canvasElement.getContext("2d");
const statusElement = document.getElementById("status");
const gestureOutputElement = document.getElementById("gestureOutput");
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");

let camera = null;
let hands = null;

const GESTURE = {
  NONE: "NONE",
  PISTOL: "PISTOL",
  OPEN_HAND: "OPEN_HAND"
};

const STABLE_FRAMES_REQUIRED = 4;
let pendingGesture = GESTURE.NONE;
let pendingGestureFrames = 0;
let stableGesture = GESTURE.NONE;

function updateStatus(message) {
  statusElement.textContent = message;
}

function updateGestureOutput(gesture) {
  gestureOutputElement.textContent = `Gesture: ${gesture}`;
}

function resizeCanvasToVideo() {
  const width = videoElement.videoWidth || 640;
  const height = videoElement.videoHeight || 480;
  canvasElement.width = width;
  canvasElement.height = height;
}

function distance3D(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = (a.z || 0) - (b.z || 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function angle3D(a, b, c) {
  const ab = [a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0)];
  const cb = [c.x - b.x, c.y - b.y, (c.z || 0) - (b.z || 0)];

  const dot = ab[0] * cb[0] + ab[1] * cb[1] + ab[2] * cb[2];
  const magAB = Math.hypot(ab[0], ab[1], ab[2]);
  const magCB = Math.hypot(cb[0], cb[1], cb[2]);
  const denom = Math.max(magAB * magCB, 1e-6);
  const cosine = Math.min(1, Math.max(-1, dot / denom));

  return (Math.acos(cosine) * 180) / Math.PI;
}

function getPalmSize(landmarks) {
  return distance3D(landmarks[0], landmarks[9]);
}

function getPalmCenter(landmarks) {
  const points = [landmarks[0], landmarks[5], landmarks[9], landmarks[13], landmarks[17]];
  const center = { x: 0, y: 0, z: 0 };

  for (const point of points) {
    center.x += point.x;
    center.y += point.y;
    center.z += point.z || 0;
  }

  center.x /= points.length;
  center.y /= points.length;
  center.z /= points.length;

  return center;
}

function isFingerExtended(landmarks, mcp, pip, dip, tip) {
  const pipAngle = angle3D(landmarks[mcp], landmarks[pip], landmarks[dip]);
  const dipAngle = angle3D(landmarks[pip], landmarks[dip], landmarks[tip]);
  const wristDistanceCheck = distance3D(landmarks[tip], landmarks[0]) > distance3D(landmarks[pip], landmarks[0]) * 1.01;
  const tipAwayFromKnuckle = distance3D(landmarks[tip], landmarks[mcp]) > distance3D(landmarks[dip], landmarks[mcp]) * 1.05;

  return pipAngle > 150 && dipAngle > 145 && (wristDistanceCheck || tipAwayFromKnuckle);
}

function isFingerFolded(landmarks, mcp, pip, dip, tip) {
  const palmSize = getPalmSize(landmarks);
  const palmCenter = getPalmCenter(landmarks);
  const pipAngle = angle3D(landmarks[mcp], landmarks[pip], landmarks[dip]);
  const dipAngle = angle3D(landmarks[pip], landmarks[dip], landmarks[tip]);
  const tipNearPalm = distance3D(landmarks[tip], palmCenter) < palmSize * 0.8;
  const tipBehindPip = distance3D(landmarks[tip], landmarks[0]) < distance3D(landmarks[pip], landmarks[0]) * 1.02;

  return (pipAngle < 145 && dipAngle < 150 && tipBehindPip) || tipNearPalm;
}

function isIndexPointingForward(landmarks) {
  const mcp = landmarks[5];
  const pip = landmarks[6];
  const dip = landmarks[7];
  const tip = landmarks[8];
  const palmSize = Math.max(getPalmSize(landmarks), 1e-6);

  const pipAngle = angle3D(mcp, pip, dip);
  const dipAngle = angle3D(pip, dip, tip);
  const straightEnough = pipAngle > 145 && dipAngle > 140;
  const tipForwardInDepth = tip.z < dip.z - 0.01 && dip.z < pip.z + 0.03;
  const indexLength3D = distance3D(tip, mcp);
  const projectedLength2D = Math.hypot(tip.x - mcp.x, tip.y - mcp.y);

  return straightEnough && tipForwardInDepth && indexLength3D > palmSize * 0.5 && projectedLength2D < palmSize * 0.95;
}

function getPistolScore(landmarks, states) {
  const palmSize = Math.max(getPalmSize(landmarks), 1e-6);
  const indexForward = isIndexPointingForward(landmarks);
  const indexActive = states.indexExtended || indexForward;
  const foldedCount = [states.middleFolded, states.ringFolded, states.pinkyFolded].filter(Boolean).length;
  const thumbTip = landmarks[4];
  const thumbBase = landmarks[2];
  const thumbReach = distance3D(thumbTip, thumbBase);
  const thumbUsable = states.thumbExtended || thumbReach > palmSize * 0.32;
  const indexTipToWrist = distance3D(landmarks[8], landmarks[0]);
  const otherTipMax = Math.max(
    distance3D(landmarks[12], landmarks[0]),
    distance3D(landmarks[16], landmarks[0]),
    distance3D(landmarks[20], landmarks[0])
  );
  const indexDominant = indexTipToWrist > otherTipMax * 1.05;

  let score = 0;
  if (indexActive) score += 0.45;
  if (indexForward) score += 0.2;
  if (foldedCount >= 2) score += 0.2;
  if (thumbUsable) score += 0.1;
  if (indexDominant) score += 0.1;

  return {
    score,
    indexForward,
    foldedCount
  };
}

function detectGesture(landmarks) {
  const thumbExtended = isFingerExtended(landmarks, 1, 2, 3, 4);
  const indexExtended = isFingerExtended(landmarks, 5, 6, 7, 8);
  const middleExtended = isFingerExtended(landmarks, 9, 10, 11, 12);
  const ringExtended = isFingerExtended(landmarks, 13, 14, 15, 16);
  const pinkyExtended = isFingerExtended(landmarks, 17, 18, 19, 20);

  const middleFolded = isFingerFolded(landmarks, 9, 10, 11, 12);
  const ringFolded = isFingerFolded(landmarks, 13, 14, 15, 16);
  const pinkyFolded = isFingerFolded(landmarks, 17, 18, 19, 20);

  if (thumbExtended && indexExtended && middleExtended && ringExtended && pinkyExtended) {
    return GESTURE.OPEN_HAND;
  }

  const states = {
    thumbExtended,
    indexExtended,
    middleFolded,
    ringFolded,
    pinkyFolded
  };
  const pistol = getPistolScore(landmarks, states);

  if (pistol.score >= 0.65 && pistol.foldedCount >= 2) {
    return GESTURE.PISTOL;
  }

  return GESTURE.NONE;
}

function smoothGesture(rawGesture, payload) {
  if (rawGesture === pendingGesture) {
    pendingGestureFrames += 1;
  } else {
    pendingGesture = rawGesture;
    pendingGestureFrames = 1;
  }

  if (pendingGestureFrames >= STABLE_FRAMES_REQUIRED && stableGesture !== rawGesture) {
    stableGesture = rawGesture;
    window.dispatchEvent(new CustomEvent("gesturechange", { detail: payload }));
  }

  return stableGesture;
}

function drawGestureLabel(text, x, y) {
  canvasCtx.font = "700 16px Segoe UI";
  const paddingX = 8;
  const boxHeight = 26;
  const textWidth = canvasCtx.measureText(text).width;
  const boxWidth = textWidth + paddingX * 2;
  const drawX = Math.max(8, Math.min(x - boxWidth / 2, canvasElement.width - boxWidth - 8));
  const drawY = Math.max(8, y - 36);

  canvasCtx.fillStyle = "rgba(10, 18, 30, 0.72)";
  canvasCtx.fillRect(drawX, drawY, boxWidth, boxHeight);
  canvasCtx.fillStyle = "#ffffff";
  canvasCtx.fillText(text, drawX + paddingX, drawY + 18);
}

function drawResults(results) {
  resizeCanvasToVideo();

  canvasCtx.save();
  canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
  canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);

  let rawGesture = GESTURE.NONE;
  let gesturePayload = {
    gesture: GESTURE.NONE,
    handedness: "Unknown",
    aim: null
  };

  if (results.multiHandLandmarks) {
    for (let i = 0; i < results.multiHandLandmarks.length; i += 1) {
      const landmarks = results.multiHandLandmarks[i];
      const handedness = results.multiHandedness?.[i]?.label || "Unknown";
      const gesture = detectGesture(landmarks);

      if (rawGesture === GESTURE.NONE) {
        rawGesture = gesture;
        gesturePayload = {
          gesture,
          handedness,
          aim: gesture === GESTURE.PISTOL
            ? { x: landmarks[8].x, y: landmarks[8].y, z: landmarks[8].z || 0 }
            : null
        };
      }

      drawConnectors(canvasCtx, landmarks, HAND_CONNECTIONS, {
        color: "#21d07a",
        lineWidth: 3
      });
      drawLandmarks(canvasCtx, landmarks, {
        color: "#ff5353",
        lineWidth: 1,
        radius: 4
      });

      if (gesture !== GESTURE.NONE) {
        drawGestureLabel(gesture, landmarks[0].x * canvasElement.width, landmarks[0].y * canvasElement.height);
      }
    }
  }

  const displayedGesture = smoothGesture(rawGesture, gesturePayload);
  updateGestureOutput(displayedGesture);
  updateStatus(`Tracking hands... (${displayedGesture})`);

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
  pendingGesture = GESTURE.NONE;
  pendingGestureFrames = 0;
  stableGesture = GESTURE.NONE;
  updateGestureOutput(GESTURE.NONE);
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
