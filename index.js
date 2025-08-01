const express = require('express');
const bodyParser = require('body-parser');
const app = express();
app.use(bodyParser.json());

// Configs
const MAX_RETRIES = 3;

// Utility to map word-based digits to numbers
const wordToDigit = {
  "zero": "0",
  "one": "1",
  "two": "2",
  "three": "3",
  "four": "4",
  "five": "5",
  "six": "6",
  "seven": "7",
  "eight": "8",
  "nine": "9"
};

function extractFirstDigit(transcript) {
  if (!transcript) return null;

  // Match numeric digit: "press 1"
  let match = transcript.match(/press\s+(\d)/i);
  if (match) return match[1];

  // Match word digit: "press one"
  match = transcript.match(/press\s+(one|two|three|four|five|six|seven|eight|nine|zero)/i);
  if (match) return wordToDigit[match[1].toLowerCase()];

  return null;
}

function isHumanDetected(transcript) {
  // If IVR seems done and human is speaking, assume success
  return /my name is|this is|i’d like to|speaking/i.test(transcript);
}

function detectIVRFailure(transcript) {
  // Common IVR error messages
  return /we didn't get your response|i didn't hear|not a valid option/i.test(transcript);
}

app.post('/ivr', (req, res) => {
  const {
    transcript = "",
    ivr_level = 1,
    ivr_retry_count = 0,
    last_digit_pressed = ""
  } = req.body;

  const normalized = transcript.toLowerCase();

  // Case 1: Human detected
  if (isHumanDetected(normalized)) {
    return res.json({
      action: "success",
      transition: "start-node-1752502982272" // your actual welcome node ID
    });
  }

  // Case 2: Retry if last response failed
  if (detectIVRFailure(normalized)) {
    if (ivr_retry_count >= MAX_RETRIES) {
      return res.json({
        action: "fail",
        reason: "Exceeded IVR retries"
      });
    }
    return res.json({
      action: "retry_digit",
      digit: last_digit_pressed,
      ivr_level,
      ivr_retry_count: ivr_retry_count + 1,
      last_digit_pressed
    });
  }

  // Case 3: Extract digit to press
  // If digit was already pressed once, and this is not a retry, ignore new "press" prompts
  if (last_digit_pressed && !detectIVRFailure(normalized)) {
    console.log("digit already pressed", last_digit_pressed);
    return res.json({
      action: "wait",
      reason: "digit already pressed",
      last_digit_pressed,
      ivr_retry_count,
      ivr_level
    });
  }
  
  const digitToPress = extractFirstDigit(normalized);
  if (digitToPress) {
    return res.json({
      action: "press_digit",
      digit: digitToPress,
      last_digit_pressed: digitToPress,
      ivr_retry_count,
      ivr_level
    });
  }
  

  // Case 4: No action can be taken yet
  return res.json({
    action: "fail",
    reason: "No digit or human detected",
    ivr_level,
    ivr_retry_count,
    last_digit_pressed
  });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`IVR Handler listening on port ${PORT}`);
});
