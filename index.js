const express = require('express');
const bodyParser = require('body-parser');
const app = express();
app.use(bodyParser.json());

// Configs
const MAX_RETRIES = 3;

// Memory cache
let digitSent = false;
let lastPressedDigit = "";
let ivrRetryCount = 0;
let ivrLevel = 1;

// Utility: Convert word to digit
const wordToDigit = {
  "zero": "0", "one": "1", "two": "2", "three": "3", "four": "4",
  "five": "5", "six": "6", "seven": "7", "eight": "8", "nine": "9"
};

function extractFirstDigit(transcript) {
  if (!transcript) return null;

  // Match numeric
  let match = transcript.match(/press\s+(\d)/i);
  if (match) return match[1];

  // Match word-based digit
  match = transcript.match(/press\s+(zero|one|two|three|four|five|six|seven|eight|nine)/i);
  if (match) return wordToDigit[match[1].toLowerCase()];

  return null;
}

function isHumanDetected(transcript) {
  return /my name is|this is|i’d like to|speaking|can i talk to/i.test(transcript);
}

function detectIVRFailure(transcript) {
  return /we didn't get your response|i didn't hear|not a valid option|try again/i.test(transcript);
}

app.post('/ivr', (req, res) => {
  const {
    transcript = "",
    last_digit_pressed = "",
    ivr_level: clientLevel = 1,
    ivr_retry_count: clientRetryCount = 0
  } = req.body;

  const normalized = transcript.toLowerCase();

  // Update memory from input
  ivrLevel = clientLevel;
  ivrRetryCount = clientRetryCount;

  // Case 1: Human detected
  if (isHumanDetected(normalized)) {
    digitSent = false;
    return res.json({
      action: "success",
      transition: "start-node-1752502982272" // ← Update this with actual welcome node ID
    });
  }

  // Case 2: Retry prompt
  if (detectIVRFailure(normalized)) {
    if (ivrRetryCount >= MAX_RETRIES) {
      digitSent = false;
      return res.json({
        action: "fail",
        reason: "Exceeded IVR retries"
      });
    }

    digitSent = false;
    return res.json({
      action: "retry_digit",
      digit: lastPressedDigit,
      ivr_level,
      ivr_retry_count: ivrRetryCount + 1,
      last_digit_pressed: lastPressedDigit
    });
  }

  // Case 3: Already sent a digit, don't send again
  if (digitSent && !detectIVRFailure(normalized)) {
    return res.json({
      action: "wait",
      reason: "digit already sent",
      last_digit_pressed: lastPressedDigit,
      ivr_retry_count: ivrRetryCount,
      ivr_level: ivrLevel
    });
  }

  // Case 4: New digit found
  const digitToPress = extractFirstDigit(normalized);
  if (digitToPress) {
    digitSent = true;
    lastPressedDigit = digitToPress;
    return res.json({
      action: "press_digit",
      digit: digitToPress,
      last_digit_pressed: digitToPress,
      ivr_retry_count: ivrRetryCount,
      ivr_level: ivrLevel
    });
  }

  // Default: wait for more input
  return res.json({
    action: "wait",
    reason: "no action triggered",
    last_digit_pressed: lastPressedDigit,
    ivr_retry_count: ivrRetryCount,
    ivr_level: ivrLevel
  });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`IVR Handler listening on port ${PORT}`);
});
