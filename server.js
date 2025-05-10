// ... (keep all existing code from express_server_js_specialist_status_v14 - imports, Twilio client, configs, other routes etc.) ...

// --- VAPI Endpoint to prepare for a sequential transfer (MINIMAL VERSION FOR TIMEOUT TEST) ---
app.post('/api/vapi/prepare-sequential-transfer', (req, res) => {
  const requestTimestamp = new Date().toISOString();
  console.log(`--- Minimal /api/vapi/prepare-sequential-transfer HIT ---`);
  console.log('Timestamp:', requestTimestamp);
  
  let toolCallIdForResponse = "unknown_tool_call_id_minimal_test"; // Default

  try {
    // Attempt to log the raw body structure minimally
    if (req.body && typeof req.body === 'object') {
        console.log('Minimal Test - req.body keys:', Object.keys(req.body).join(', '));
        if (req.body.message && req.body.message.toolCallList && Array.isArray(req.body.message.toolCallList) && req.body.message.toolCallList.length > 0 && req.body.message.toolCallList[0] && req.body.message.toolCallList[0].id) {
            toolCallIdForResponse = req.body.message.toolCallList[0].id;
        } else if (req.body.toolCall && req.body.toolCall.toolCallId) {
            toolCallIdForResponse = req.body.toolCall.toolCallId;
        }
    } else {
        console.log('Minimal Test - req.body is not an object or is null/undefined.');
    }
  } catch (e) {
    console.error('Minimal Test - Error accessing req.body properties:', e.message);
  }

  console.log(`Minimal Test - Responding 200 OK for toolCallId: ${toolCallIdForResponse}`);
  
  // Immediately send a success response
  res.status(200).json({
    results: [{ 
        toolCallId: toolCallIdForResponse, 
        result: "Minimal test endpoint: Successfully acknowledged VAPI prepare request."
    }]
  });
});

// ... (keep app.listen and module.exports at the end, and other routes like /health, /twilio/voice/* ) ...
