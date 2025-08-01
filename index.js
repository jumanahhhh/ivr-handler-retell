const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

let digitPressedFlag = false; // NEW: Global flag to track if digit was actually sent
let lastPressedDigit = "";
let ivrRetryCount = 0;
let ivrLevel = 1;

function extractFirstDigit(text) {
  const match = text.match(/press (one|two|three|four|five|\d)/i);
  if (!match) return null;

  const digitWord = match[1].toLowerCase();
  const map = { one: "1", two: "2", three: "3", four: "4", five: "5" };
  return map[digitWord] || digitWord;
}

function detectIVRFailure(text) {
  return /didn['’]t|get your response|not a valid|try again/i.test(text);
}

app.post("/ivr", (req, res) => {
  const { transcript, last_digit_pressed } = req.body;
  const normalized = transcript?.toLowerCase() || "";

  // Retry logic: if IVR says “we didn’t get your response”
  if (detectIVRFailure(normalized)) {
    if (ivrRetryCount >= 2) {
      return res.json({ action: "fail", reason: "too many retries" });
    }

    digitPressedFlag = false; // reset
    return res.json({
      action: "retry_digit",
      digit: lastPressedDigit,
      ivr_level: ivrLevel,
      ivr_retry_count: ++ivrRetryCount,
      last_digit_pressed: lastPressedDigit,
    });
  }

  // If digit was already sent to press and IVR hasn’t failed, just wait
  if (digitPressedFlag) {
    return res.json({
      action: "wait",
      reason: "digit already being handled",
      last_digit_pressed: lastPressedDigit,
      ivr_level: ivrLevel,
      ivr_retry_count: ivrRetryCount,
    });
  }

  // New digit detection
  const digitToPress = extractFirstDigit(normalized);
  if (digitToPress) {
    digitPressedFlag = true;
    lastPressedDigit = digitToPress;
    return res.json({
      action: "press_digit",
      digit: digitToPress,
      last_digit_pressed: digitToPress,
      ivr_retry_count: ivrRetryCount,
      ivr_level: ivrLevel,
    });
  }

  // Default fallback
  return res.json({
    action: "wait",
    reason: "no digit found",
    last_digit_pressed: lastPressedDigit,
    ivr_retry_count: ivrRetryCount,
    ivr_level: ivrLevel,
  });
});

app.listen(3000, () => {
  console.log("IVR handler running on port 3000");
});
