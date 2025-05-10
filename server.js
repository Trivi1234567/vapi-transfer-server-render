// Import necessary modules
const express = require('express');
const dotenv = require('dotenv');

// Load environment variables from .env file
dotenv.config();

// Temporary in-memory store for pending transfers
const pendingTransfers = {};

// Initialize the Express application
const app = express();

// Middleware to parse JSON bodies
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 3000;

app.get('/health', (req, res) => {
  console.log('Health check endpoint was hit!');
  res.status(200).json({ status: 'UP', message: 'Server is healthy' });
});

app.post('/api/vapi/prepare-sequential-transfer', (req, res) => {
  console.log('--- New Request to /api/vapi/prepare-sequential-transfer ---');
  console.log('Timestamp:', new Date().toISOString());
  console.log('Request Body from VAPI:', JSON.stringify(req.body, null, 2));

  let departmentName;
  let actualVapiCallId;
  let actualUserPhoneNumber;
  let toolCallIdForResponse = "unknown_tool_call_id"; // Default

  // Attempt to extract toolCallIdForResponse (for responding to VAPI)
  try {
    if (req.body && req.body.message && req.body.message.toolCallList && req.body.message.toolCallList.length > 0 && req.body.message.toolCallList[0].id) {
      toolCallIdForResponse = req.body.message.toolCallList[0].id;
      console.log(`SUCCESS: Extracted toolCallIdForResponse: ${toolCallIdForResponse}`);
    } else if (req.body && req.body.toolCall && req.body.toolCall.toolCallId) { // Fallback
        toolCallIdForResponse = req.body.toolCall.toolCallId;
        console.log(`SUCCESS (Fallback): Extracted toolCallIdForResponse: ${toolCallIdForResponse}`);
    } else {
      console.warn('WARNING: toolCallIdForResponse could not be extracted from expected paths.');
    }
  } catch (e) {
    console.error('ERROR extracting toolCallIdForResponse:', e);
  }

  // Attempt to extract departmentName from LLM arguments
  try {
    if (req.body && req.body.message && req.body.message.toolCallList && req.body.message.toolCallList.length > 0 &&
        req.body.message.toolCallList[0].function && req.body.message.toolCallList[0].function.arguments &&
        req.body.message.toolCallList[0].function.arguments.departmentName) {
      departmentName = req.body.message.toolCallList[0].function.arguments.departmentName;
      console.log(`SUCCESS: Extracted departmentName from LLM args: '${departmentName}'`);
    } else {
      console.warn('WARNING: departmentName not found in req.body.message.toolCallList[0].function.arguments.departmentName');
    }
  } catch (e) {
    console.error('ERROR extracting departmentName:', e);
  }

  // Attempt to extract actualVapiCallId from the main call object
  try {
    if (req.body && req.body.call && req.body.call.id && typeof req.body.call.id === 'string' && req.body.call.id.trim() !== '') {
      actualVapiCallId = req.body.call.id;
      console.log(`SUCCESS: Extracted actualVapiCallId from req.body.call.id: '${actualVapiCallId}'`);
    } else {
      console.warn(`WARNING: actualVapiCallId not found or invalid in req.body.call.id. Value: ${req.body.call ? req.body.call.id : 'req.body.call missing'}`);
    }
  } catch (e) {
    console.error('ERROR extracting actualVapiCallId:', e);
  }

  // Attempt to extract actualUserPhoneNumber from the main call object
  try {
    if (req.body && req.body.call && req.body.call.customer && req.body.call.customer.number &&
        typeof req.body.call.customer.number === 'string' && req.body.call.customer.number.trim() !== '') {
      actualUserPhoneNumber = req.body.call.customer.number;
      console.log(`SUCCESS: Extracted actualUserPhoneNumber from req.body.call.customer.number: '${actualUserPhoneNumber}'`);
    } else {
      console.warn(`WARNING: actualUserPhoneNumber not found or invalid in req.body.call.customer.number. Value: ${req.body.call && req.body.call.customer ? req.body.call.customer.number : 'req.body.call.customer missing'}`);
      actualUserPhoneNumber = null; // Ensure it's null if not found
    }
  } catch (e) {
    console.error('ERROR extracting actualUserPhoneNumber:', e);
    actualUserPhoneNumber = null;
  }

  // --- Validations ---
  if (!departmentName) {
    console.error('CRITICAL_VALIDATION_FAILURE: departmentName is missing or invalid. Cannot proceed.');
    return res.status(400).json({
      toolCallId: toolCallIdForResponse,
      result: "Error: Missing or invalid 'departmentName' parameter from VAPI's tool call."
    });
  }

  if (!actualVapiCallId) {
    console.error("CRITICAL_VALIDATION_FAILURE: actualVapiCallId could not be determined. Cannot proceed.");
    return res.status(400).json({
      toolCallId: toolCallIdForResponse,
      result: "Error: Critical identifier 'vapiCallId' could not be determined from request payload."
    });
  }

  // --- Process and Store ---
  const storageKey = actualUserPhoneNumber || actualVapiCallId; 

  pendingTransfers[storageKey] = {
    departmentName: departmentName,
    vapiCallId: actualVapiCallId,
    userPhoneNumber: actualUserPhoneNumber || 'N/A',
    timestamp: new Date().toISOString(),
    status: 'pending_vapi_transfer_to_twilio'
  };

  console.log(`SUCCESS_PROCESS: Prepared for sequential transfer for storageKey '${storageKey}' to department: ${departmentName}`);
  console.log('Current pendingTransfers:', JSON.stringify(pendingTransfers, null, 2));

  // Send success response back to VAPI
  res.status(200).json({
    toolCallId: toolCallIdForResponse,
    result: `Successfully prepared for transfer to ${departmentName}. Ready for call.`
  });
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
  console.log('Press Ctrl+C to stop the server.');
  if (process.env.YOUR_RENDER_APP_BASE_URL && process.env.YOUR_RENDER_APP_BASE_URL !== `http://localhost:${PORT}`) {
    console.log(`Once deployed, it should be accessible at ${process.env.YOUR_RENDER_APP_BASE_URL}`);
  }
});

module.exports = app;
