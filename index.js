import express from "express";

const app = express();
app.use(express.json());

function extractFirstDigit(transcript) {
    if (!transcript) return null;
  
    // Map of word digits to numbers
    const wordToDigit = {
      "one": "1",
      "two": "2",
      "three": "3",
      "four": "4",
      "five": "5",
      "six": "6",
      "seven": "7",
      "eight": "8",
      "nine": "9",
      "zero": "0"
    };
  
    // Try to extract digit (press 1, press 2)
    let match = transcript.match(/press\s+(\d)/i);
    if (match) return match[1];
  
    // Try to extract word-form (press one, press two)
    match = transcript.match(/press\s+(one|two|three|four|five|six|seven|eight|nine|zero)/i);
    if (match) return wordToDigit[match[1].toLowerCase()];
  
    return null;
  }
  

app.post("/ivr", (req, res) => {
  const {
    transcript,
    ivr_level = 1,
    ivr_retry_count = 0,
    last_digit_pressed = ""
  } = req.body;

  const response = {
    ivr_level,
    ivr_retry_count,
    last_digit_pressed
  };

  const isHumanDetected = /how can i help|this is|speaking|hello|good morning|thank you for calling/i.test(transcript);
  const digit = extractFirstDigit(transcript);

  if (isHumanDetected) {
    response.action = "success";
    response.transition = "start-node-1752502982272"; // your Welcome Node ID
  } else if (digit) {
    response.action = "press_digit";
    response.digit = digit;
    response.last_digit_pressed = digit;
    response.ivr_retry_count = 0;
  } else if (last_digit_pressed && ivr_retry_count < 3) {
    response.action = "retry_digit";
    response.digit = last_digit_pressed;
    response.ivr_retry_count += 1;
  } else {
    response.action = "fail";
  }

  res.json(response);
});

app.get("/", (req, res) => res.send("IVR Handler is running."));
app.listen(process.env.PORT || 3000, () => console.log("IVR handler running."));
