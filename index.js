const express = require('express');
const bodyParser = require('body-parser');
const app = express();
app.use(bodyParser.json());

// Configs
const MAX_RETRIES = 3;
const MAX_IVR_LEVELS = 5;
const SESSION_TIMEOUT = 300000; // 5 minutes

// Session-based state management
const sessions = new Map();

class IVRSession {
  constructor(sessionId) {
    this.sessionId = sessionId;
    this.digitSent = false;
    this.lastPressedDigit = "";
    this.ivrRetryCount = 0;
    this.ivrLevel = 1;
    this.navigationHistory = [];
    this.lastActivity = Date.now();
    this.menuContext = null;
  }

  updateActivity() {
    this.lastActivity = Date.now();
  }

  addToHistory(action, digit = null) {
    this.navigationHistory.push({
      level: this.ivrLevel,
      action,
      digit,
      timestamp: Date.now()
    });
  }
}

// Cleanup old sessions periodically
setInterval(() => {
  const now = Date.now();
  for (const [sessionId, session] of sessions.entries()) {
    if (now - session.lastActivity > SESSION_TIMEOUT) {
      sessions.delete(sessionId);
    }
  }
}, 60000); // Clean every minute

// Enhanced digit extraction
const wordToDigit = {
  "zero": "0", "one": "1", "two": "2", "three": "3", "four": "4",
  "five": "5", "six": "6", "seven": "7", "eight": "8", "nine": "9",
  "oh": "0"
};

function extractDigits(transcript) {
  if (!transcript) return [];
  
  const normalized = transcript.toLowerCase();
  const digits = [];
  
  // Pattern 1: "press X" or "press X for Y"
  let matches = normalized.match(/press\s+(\d|zero|one|two|three|four|five|six|seven|eight|nine|oh)/gi);
  if (matches) {
    matches.forEach(match => {
      const digitMatch = match.match(/press\s+(\d|zero|one|two|three|four|five|six|seven|eight|nine|oh)/i);
      if (digitMatch) {
        const digit = isNaN(digitMatch[1]) ? wordToDigit[digitMatch[1]] : digitMatch[1];
        if (digit && !digits.includes(digit)) digits.push(digit);
      }
    });
  }
  
  // Pattern 2: "for X, press Y" or "X for Y"
  matches = normalized.match(/(?:for\s+.*?,?\s*press\s+|to\s+.*?,?\s*press\s+)(\d|zero|one|two|three|four|five|six|seven|eight|nine|oh)/gi);
  if (matches) {
    matches.forEach(match => {
      const digitMatch = match.match(/press\s+(\d|zero|one|two|three|four|five|six|seven|eight|nine|oh)/i);
      if (digitMatch) {
        const digit = isNaN(digitMatch[1]) ? wordToDigit[digitMatch[1]] : digitMatch[1];
        if (digit && !digits.includes(digit)) digits.push(digit);
      }
    });
  }
  
  // Pattern 3: Single digit mentions in context
  matches = normalized.match(/(?:option\s+|number\s+)(\d|zero|one|two|three|four|five|six|seven|eight|nine|oh)/gi);
  if (matches) {
    matches.forEach(match => {
      const digitMatch = match.match(/(?:option\s+|number\s+)(\d|zero|one|two|three|four|five|six|seven|eight|nine|oh)/i);
      if (digitMatch) {
        const digit = isNaN(digitMatch[1]) ? wordToDigit[digitMatch[1]] : digitMatch[1];
        if (digit && !digits.includes(digit)) digits.push(digit);
      }
    });
  }
  
  return digits;
}

function selectBestDigit(digits, context = null) {
  if (!digits.length) return null;
  
  // Priority order for healthcare/medical office calls
  const priorities = {
    // High priority - likely to connect to humans
    '0': 10,  // Usually operator/receptionist
    '2': 8,   // Often appointments/scheduling
    '1': 7,   // Often main menu or general info
    '3': 6,   // Sometimes billing
    '4': 5,   // Sometimes other services
    '5': 4,
    '6': 3,
    '7': 2,
    '8': 1,
    '9': 1
  };
  
  // Sort by priority, highest first
  return digits.sort((a, b) => (priorities[b] || 0) - (priorities[a] || 0))[0];
}

function isHumanDetected(transcript) {
  if (!transcript) return false;
  
  const normalized = transcript.toLowerCase();
  
  // Positive human indicators
  const humanPatterns = [
    /my name is/i,
    /this is\s+\w+/i,
    /speaking/i,
    /can i help you/i,
    /how may i/i,
    /good morning/i,
    /good afternoon/i,
    /hello.*office/i,
    /thank you for calling/i,
    /you've reached.*office/i,
    /^hello$/i,
    /^hi$/i,
    /yes\?$/i,
    /how can i assist/i,
    /what can i do for you/i
  ];
  
  // Check for human patterns
  if (humanPatterns.some(pattern => pattern.test(normalized))) {
    return true;
  }
  
  // Negative indicators (definitely IVR)
  const ivrPatterns = [
    /press.*for/i,
    /your call is important/i,
    /please hold/i,
    /all representatives are busy/i,
    /please listen carefully/i,
    /menu options have changed/i,
    /to repeat these options/i,
    /for quality assurance/i
  ];
  
  return !ivrPatterns.some(pattern => pattern.test(normalized));
}

function detectIVRFailure(transcript) {
  if (!transcript) return false;
  
  const normalized = transcript.toLowerCase();
  return /we didn't get your response|i didn't hear|not a valid option|try again|invalid selection|please try again|that's not a valid|didn't recognize/i.test(normalized);
}

function detectIVRMenu(transcript) {
  if (!transcript) return false;
  
  const normalized = transcript.toLowerCase();
  return /press.*for|for.*press|option|menu|to speak with|if you are|if this is|please listen|your call is important/i.test(normalized);
}

function detectHold(transcript) {
  if (!transcript) return false;
  
  const normalized = transcript.toLowerCase();
  return /please hold|one moment|transferring|connecting you|please wait/i.test(normalized);
}

function getSession(sessionId) {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, new IVRSession(sessionId));
  }
  const session = sessions.get(sessionId);
  session.updateActivity();
  return session;
}

app.post('/ivr', (req, res) => {
  const {
    transcript = "",
    last_digit_pressed = "",
    ivr_level: clientLevel = 1,
    ivr_retry_count: clientRetryCount = 0,
    call_id = "default"  // Use call_id as session identifier
  } = req.body;

  const session = getSession(call_id);
  const normalized = transcript.toLowerCase();

  console.log(`[${call_id}] Processing: "${transcript}"`);

  // Update session from client
  session.ivrLevel = Math.max(clientLevel, session.ivrLevel);
  session.ivrRetryCount = clientRetryCount;

  // Case 1: Human detected
  if (isHumanDetected(transcript)) {
    console.log(`[${call_id}] Human detected`);
    session.addToHistory('human_detected');
    session.digitSent = false;
    return res.json({
      action: "success",
      transition: "start-node-1752502982272",
      ivr_level: session.ivrLevel,
      ivr_retry_count: session.ivrRetryCount,
      last_digit_pressed: session.lastPressedDigit
    });
  }

  // Case 2: Hold/transfer detected
  if (detectHold(transcript)) {
    console.log(`[${call_id}] Hold/transfer detected`);
    session.addToHistory('hold_detected');
    return res.json({
      action: "wait",
      reason: "on hold or being transferred",
      ivr_level: session.ivrLevel,
      ivr_retry_count: session.ivrRetryCount,
      last_digit_pressed: session.lastPressedDigit
    });
  }

  // Case 3: IVR failure detected
  if (detectIVRFailure(transcript)) {
    console.log(`[${call_id}] IVR failure detected, retry count: ${session.ivrRetryCount}`);
    
    if (session.ivrRetryCount >= MAX_RETRIES) {
      session.addToHistory('max_retries_exceeded');
      return res.json({
        action: "fail",
        reason: "Exceeded IVR retries",
        ivr_level: session.ivrLevel,
        ivr_retry_count: session.ivrRetryCount,
        last_digit_pressed: session.lastPressedDigit
      });
    }

    session.digitSent = false;
    session.ivrRetryCount++;
    session.addToHistory('retry_required', session.lastPressedDigit);
    
    return res.json({
      action: "retry_digit",
      digit: session.lastPressedDigit,
      ivr_level: session.ivrLevel,
      ivr_retry_count: session.ivrRetryCount,
      last_digit_pressed: session.lastPressedDigit
    });
  }

  // Case 4: Check if we've exceeded max IVR levels
  if (session.ivrLevel > MAX_IVR_LEVELS) {
    console.log(`[${call_id}] Exceeded max IVR levels`);
    session.addToHistory('max_levels_exceeded');
    return res.json({
      action: "fail",
      reason: "Exceeded maximum IVR navigation depth",
      ivr_level: session.ivrLevel,
      ivr_retry_count: session.ivrRetryCount,
      last_digit_pressed: session.lastPressedDigit
    });
  }

  // Case 5: Already sent a digit, wait for response
  if (session.digitSent && !detectIVRMenu(transcript)) {
    console.log(`[${call_id}] Digit already sent, waiting...`);
    return res.json({
      action: "wait",
      reason: "digit already sent, waiting for response",
      ivr_level: session.ivrLevel,
      ivr_retry_count: session.ivrRetryCount,
      last_digit_pressed: session.lastPressedDigit
    });
  }

  // Case 6: New IVR menu detected, extract and press digit
  if (detectIVRMenu(transcript)) {
    const availableDigits = extractDigits(transcript);
    const digitToPress = selectBestDigit(availableDigits, session.menuContext);
    
    console.log(`[${call_id}] IVR menu detected. Available digits: [${availableDigits.join(', ')}], Selected: ${digitToPress}`);
    
    if (digitToPress) {
      session.digitSent = true;
      session.lastPressedDigit = digitToPress;
      session.ivrRetryCount = 0; // Reset retry count for new menu
      session.addToHistory('digit_pressed', digitToPress);
      
      return res.json({
        action: "press_digit",
        digit: digitToPress,
        available_digits: availableDigits,
        ivr_level: session.ivrLevel,
        ivr_retry_count: session.ivrRetryCount,
        last_digit_pressed: digitToPress
      });
    }
  }

  // Default: wait for more input
  console.log(`[${call_id}] Waiting for more input`);
  return res.json({
    action: "wait",
    reason: "no clear action determined",
    ivr_level: session.ivrLevel,
    ivr_retry_count: session.ivrRetryCount,
    last_digit_pressed: session.lastPressedDigit
  });
});

// Debug endpoint to check session state
app.get('/debug/:callId', (req, res) => {
  const session = sessions.get(req.params.callId);
  if (!session) {
    return res.json({ error: "Session not found" });
  }
  
  res.json({
    sessionId: session.sessionId,
    ivrLevel: session.ivrLevel,
    ivrRetryCount: session.ivrRetryCount,
    lastPressedDigit: session.lastPressedDigit,
    digitSent: session.digitSent,
    navigationHistory: session.navigationHistory,
    lastActivity: new Date(session.lastActivity).toISOString()
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    activeSessions: sessions.size,
    timestamp: new Date().toISOString()
  });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Enhanced IVR Handler listening on port ${PORT}`);
  console.log(`Debug endpoint: GET /debug/:callId`);
  console.log(`Health check: GET /health`);
});