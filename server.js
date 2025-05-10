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
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

const PORT = process.env.PORT || 3000;

app.get('/health', (req, res) => {
  console.log('Health check endpoint was hit!');
  res.status(200).json({ status: 'UP', message: 'Server is healthy' });
});

app.post('/api/vapi/prepare-sequential-transfer', (req, res) => {
  console.log('--- New Request to /api/vapi/prepare-sequential-transfer ---');
  console.log('Timestamp:', new Date().toISOString());
  try {
    console.log('Request Body from VAPI (stringified):', JSON.stringify(req.body, null, 2));
  } catch (e) {
    console.error('Error stringifying req.body:', e);
  }

  let departmentName;
  let actualVapiCallId;
  let actualUserPhoneNumber;
  let toolCallIdForResponse = "unknown_tool_call_id"; 

  try {
    const body = req.body; 

    // 1. Extract toolCallIdForResponse and departmentName
    if (body && body.message && body.message.toolCallList && Array.isArray(body.message.toolCallList) && body.message.toolCallList.length > 0) {
      const firstToolCall = body.message.toolCallList[0];
      if (firstToolCall && firstToolCall.id) {
        toolCallIdForResponse = firstToolCall.id;
        console.log(`SUCCESS: Extracted toolCallIdForResponse from message.toolCallList[0].id: ${toolCallIdForResponse}`);
      } else {
        console.warn('WARNING: message.toolCallList[0].id missing.');
      }

      if (firstToolCall && firstToolCall.function && firstToolCall.function.arguments && firstToolCall.function.arguments.departmentName) {
        departmentName = firstToolCall.function.arguments.departmentName;
        console.log(`SUCCESS: Extracted departmentName from LLM args: '${departmentName}'`);
      } else {
        console.warn('WARNING: departmentName not found in message.toolCallList[0].function.arguments.departmentName');
      }
    } else {
      console.warn('WARNING: body.message.toolCallList is not as expected. Attempting fallback for toolCallId and departmentName.');
      if (body && body.toolCall && body.toolCall.toolCallId) { 
        toolCallIdForResponse = body.toolCall.toolCallId;
        console.log(`SUCCESS (Fallback): Extracted toolCallIdForResponse from toolCall.toolCallId: ${toolCallIdForResponse}`);
        if (body.toolCall.parameters && body.toolCall.parameters.departmentName){
            departmentName = body.toolCall.parameters.departmentName;
            console.log(`SUCCESS (Fallback): Extracted departmentName from toolCall.parameters: '${departmentName}'`);
        } else if (body.toolCall.function && body.toolCall.function.arguments && body.toolCall.function.arguments.departmentName){
            departmentName = body.toolCall.function.arguments.departmentName;
            console.log(`SUCCESS (Fallback): Extracted departmentName from toolCall.function.arguments: '${departmentName}'`);
        }
      }
    }

    // 2. Extract actualVapiCallId and actualUserPhoneNumber from req.body.message.call
    console.log("--- Debugging req.body.message.call ---");
    if (body && body.message && body.message.call && typeof body.message.call === 'object' && body.message.call !== null) {
      const messageCallObject = body.message.call;
      console.log(`SUCCESS: body.message.call is an object. Keys: ${Object.keys(messageCallObject).join(', ')}`);
      
      if (messageCallObject.id && typeof messageCallObject.id === 'string' && messageCallObject.id.trim() !== '') {
        actualVapiCallId = messageCallObject.id;
        console.log(`SUCCESS: Extracted actualVapiCallId from body.message.call.id: '${actualVapiCallId}'`);
      } else {
        console.warn(`WARNING: body.message.call.id is missing, not a string, or empty. Value: '${messageCallObject.id}'`);
      }

      if (messageCallObject.customer && typeof messageCallObject.customer === 'object' && messageCallObject.customer !== null &&
          messageCallObject.customer.number && typeof messageCallObject.customer.number === 'string' && messageCallObject.customer.number.trim() !== '') {
        actualUserPhoneNumber = messageCallObject.customer.number;
        console.log(`SUCCESS: Extracted actualUserPhoneNumber from body.message.call.customer.number: '${actualUserPhoneNumber}'`);
      } else {
        console.warn(`WARNING: body.message.call.customer.number is missing, not a string, or empty. Value: ${messageCallObject.customer ? messageCallObject.customer.number : 'customer object missing in message.call'}`);
        actualUserPhoneNumber = null;
      }
    } else {
      console.warn('WARNING: body.message.call is not a valid object or is null. This is the primary expected path for call context.');
    }

  } catch (e) {
    console.error('!!! UNEXPECTED ERROR during data extraction !!!:', e.message, e.stack);
    // Ensure toolCallIdForResponse is defined, even if it's the default "unknown..."
    const responseToolCallId = toolCallIdForResponse || "unknown_tool_call_id_in_error";
    return res.status(500).json({
        results: [{ // VAPI expects 'results' to be an array
            toolCallId: responseToolCallId,
            result: "Internal server error during request processing."
        }]
    });
  }

  // --- Validations ---
  if (!departmentName) {
    console.error('CRITICAL_VALIDATION_FAILURE: departmentName is missing or invalid. Cannot proceed.');
    return res.status(400).json({
      results: [{ // VAPI expects 'results' to be an array
          toolCallId: toolCallIdForResponse,
          result: "Error: Missing or invalid 'departmentName' parameter from VAPI's tool call."
      }]
    });
  }

  if (!actualVapiCallId) {
    console.error("CRITICAL_VALIDATION_FAILURE: actualVapiCallId could not be determined. Cannot proceed.");
    return res.status(400).json({
      results: [{ // VAPI expects 'results' to be an array
          toolCallId: toolCallIdForResponse,
          result: "Error: Critical identifier 'vapiCallId' could not be determined from request payload."
      }]
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

  // Send success response back to VAPI in the correct format
  res.status(200).json({
    results: [{ // VAPI expects 'results' to be an array
        toolCallId: toolCallIdForResponse, 
        result: `Successfully prepared for transfer to ${departmentName}. Ready for call.`
    }]
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
