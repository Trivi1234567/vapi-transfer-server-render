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
  
  // Log the raw body before JSON.stringify to see its state if stringify fails
  console.log('Raw req.body reference:', req.body); 
  try {
    console.log('Request Body from VAPI (stringified):', JSON.stringify(req.body, null, 2));
  } catch (e) {
    console.error('Error stringifying req.body:', e);
  }

  // Log all top-level keys of req.body
  if (req.body && typeof req.body === 'object' && req.body !== null) {
    console.log('--- Top-level keys in req.body ---');
    for (const key in req.body) {
      // No hasOwnProperty check here for now, to see all enumerable keys
      console.log(`Key: "${key}", Type: ${typeof req.body[key]}, Value: ${JSON.stringify(req.body[key])?.substring(0,100)}`);
    }
    console.log('--- End Top-level keys ---');
  } else {
    console.log('req.body is not a valid object or is null/undefined.');
  }

  let departmentName;
  let actualVapiCallId;
  let actualUserPhoneNumber;
  let toolCallIdForResponse = "unknown_tool_call_id"; // Default

  try {
    const body = req.body; 

    // 1. Extract toolCallIdForResponse
    if (body && body.message && body.message.toolCallList && Array.isArray(body.message.toolCallList) && body.message.toolCallList.length > 0 && body.message.toolCallList[0] && body.message.toolCallList[0].id) {
      toolCallIdForResponse = body.message.toolCallList[0].id;
      console.log(`SUCCESS: Extracted toolCallIdForResponse from message.toolCallList[0].id: ${toolCallIdForResponse}`);
    } else if (body && body.toolCall && body.toolCall.toolCallId) { 
        toolCallIdForResponse = body.toolCall.toolCallId;
        console.log(`SUCCESS (Fallback): Extracted toolCallIdForResponse from toolCall.toolCallId: ${toolCallIdForResponse}`);
    } else {
      console.warn('WARNING: toolCallIdForResponse could not be extracted from expected paths.');
    }

    // 2. Extract departmentName from LLM arguments
    if (body && body.message && body.message.toolCallList && Array.isArray(body.message.toolCallList) && body.message.toolCallList.length > 0 &&
        body.message.toolCallList[0] && body.message.toolCallList[0].function && body.message.toolCallList[0].function.arguments &&
        body.message.toolCallList[0].function.arguments.departmentName) {
      departmentName = body.message.toolCallList[0].function.arguments.departmentName;
      console.log(`SUCCESS: Extracted departmentName from LLM args: '${departmentName}'`);
    } else {
      console.warn('WARNING: departmentName not found in message.toolCallList[0].function.arguments.departmentName');
    }

    // 3. Extract actualVapiCallId
    console.log("--- Debugging req.body.call (direct access) ---");
    const callObject = body.call; // Direct dot notation
    console.log(`Type of callObject (body.call): ${typeof callObject}`);
    if (callObject && typeof callObject === 'object' && callObject !== null) {
        console.log(`callObject (from body.call) keys: ${Object.keys(callObject)}`);
        if (callObject.id && typeof callObject.id === 'string' && callObject.id.trim() !== '') {
            actualVapiCallId = callObject.id;
            console.log(`SUCCESS: Extracted actualVapiCallId from callObject.id: '${actualVapiCallId}'`);
        } else {
            console.warn(`WARNING: callObject.id is missing, not a string, or empty. Value: '${callObject.id}'`);
        }
    } else {
        console.warn('WARNING: callObject (body.call) is not a valid object or is null.');
    }

    // 4. Extract actualUserPhoneNumber
    if (callObject && typeof callObject === 'object' && callObject !== null &&
        callObject.customer && typeof callObject.customer === 'object' && callObject.customer !== null) {
        console.log(`callObject.customer (from body.call.customer) keys: ${Object.keys(callObject.customer)}`);
        if (callObject.customer.number && typeof callObject.customer.number === 'string' && callObject.customer.number.trim() !== '') {
            actualUserPhoneNumber = callObject.customer.number;
            console.log(`SUCCESS: Extracted actualUserPhoneNumber from callObject.customer.number: '${actualUserPhoneNumber}'`);
        } else {
            console.warn(`WARNING: callObject.customer.number is missing, not a string, or empty. Value: '${callObject.customer.number}'`);
        }
    } else {
        console.warn('WARNING: callObject.customer is not a valid object, is null, or callObject itself is invalid for customer lookup.');
        actualUserPhoneNumber = null;
    }

  } catch (e) {
    console.error('!!! UNEXPECTED ERROR during data extraction !!!:', e.message, e.stack);
    return res.status(500).json({
        toolCallId: toolCallIdForResponse,
        result: "Internal server error during request processing."
    });
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
