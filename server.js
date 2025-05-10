// Import necessary modules
const express = require('express');
const dotenv = require('dotenv');

// Load environment variables from .env file
dotenv.config();

// Temporary in-memory store for pending transfers
// Key: userPhoneNumber (or vapiCallId if userPhoneNumber is not available)
// Value: { departmentName, vapiCallIdFromCallObject, timestamp, status }
const pendingTransfers = {};

// Initialize the Express application
const app = express();

// Middleware to parse JSON bodies
app.use(express.json());
// Middleware to parse URL-encoded bodies
app.use(express.urlencoded({ extended: true }));

// Define a simple port, defaulting to 3000 if not set in .env
const PORT = process.env.PORT || 3000;

// --- Define a basic health check route ---
app.get('/health', (req, res) => {
  console.log('Health check endpoint was hit!');
  res.status(200).json({ status: 'UP', message: 'Server is healthy' });
});

// --- VAPI Endpoint to prepare for a sequential transfer ---
app.post('/api/vapi/prepare-sequential-transfer', (req, res) => {
  console.log('Received request on /api/vapi/prepare-sequential-transfer');
  console.log('Request Body from VAPI:', JSON.stringify(req.body, null, 2));

  let departmentName, vapiCallIdFromToolArgs, userPhoneNumberFromToolArgs;
  let vapiCallIdFromCallObject; // The main call ID from req.body.call.id
  let userPhoneNumberFromCallObject; // From req.body.call.customer.number
  let toolCallIdForResponse; // The ID VAPI sends for this specific tool invocation

  // Extract toolCallId for the response (VAPI expects this back)
  // Based on logs: req.body.message.toolCallList[0].id
  if (req.body.message && req.body.message.toolCallList && req.body.message.toolCallList.length > 0) {
    toolCallIdForResponse = req.body.message.toolCallList[0].id;
  } else if (req.body.toolCall && req.body.toolCall.toolCallId) { // Older VAPI structure or alternative
    toolCallIdForResponse = req.body.toolCall.toolCallId;
  }
  console.log(`Extracted toolCallIdForResponse: ${toolCallIdForResponse}`);


  // Extract parameters passed by the LLM within the tool arguments
  // Based on logs: req.body.message.toolCallList[0].arguments
  if (req.body.message && req.body.message.toolCallList && req.body.message.toolCallList.length > 0 && req.body.message.toolCallList[0].arguments) {
    const toolArguments = req.body.message.toolCallList[0].arguments;
    departmentName = toolArguments.departmentName; // This was missing in the test call
    vapiCallIdFromToolArgs = toolArguments.vapiCallId; // LLM was supposed to pass this
    userPhoneNumberFromToolArgs = toolArguments.userPhoneNumber; // LLM was supposed to pass this
    console.log(`Tool Arguments: departmentName='${departmentName}', vapiCallIdFromToolArgs='${vapiCallIdFromToolArgs}', userPhoneNumberFromToolArgs='${userPhoneNumberFromToolArgs}'`);
  } else {
    console.warn('Could not find tool arguments in req.body.message.toolCallList[0].arguments');
  }

  // Extract overall call information (more reliable source for call ID and user number)
  // Based on logs: req.body.call.id and req.body.call.customer.number
  if (req.body.call) {
    vapiCallIdFromCallObject = req.body.call.id;
    if (req.body.call.customer && req.body.call.customer.number) {
      userPhoneNumberFromCallObject = req.body.call.customer.number;
    }
    console.log(`Call Object Info: vapiCallIdFromCallObject='${vapiCallIdFromCallObject}', userPhoneNumberFromCallObject='${userPhoneNumberFromCallObject}'`);
  } else {
    console.warn('Could not find req.body.call object for primary call identifiers.');
  }

  // Prioritize identifiers from the main 'call' object if available, as they are more direct.
  const finalVapiCallId = vapiCallIdFromCallObject || vapiCallIdFromToolArgs;
  const finalUserPhoneNumber = userPhoneNumberFromCallObject || userPhoneNumberFromToolArgs;

  // Validate required parameters
  if (!departmentName) { // departmentName is the critical one LLM needs to provide
    console.error('CRITICAL: departmentName is missing in the request from VAPI tool arguments.');
    return res.status(400).json({
      toolCallId: toolCallIdForResponse, // Send back the ID VAPI gave us for this tool call
      result: `Error: Missing required 'departmentName' parameter from VAPI. Cannot proceed.`
    });
  }
  if (!finalVapiCallId) {
    console.error('CRITICAL: Could not determine vapiCallId from request.');
     return res.status(400).json({
      toolCallId: toolCallIdForResponse,
      result: `Error: Missing 'vapiCallId' in the request from VAPI. Cannot proceed.`
    });
  }

  // Use finalUserPhoneNumber as the primary key for pendingTransfers if available, otherwise finalVapiCallId.
  const storageKey = finalUserPhoneNumber || finalVapiCallId;
  if (!storageKey) {
    // This case should ideally not be reached if finalVapiCallId is present
    console.error('CRITICAL: Could not determine a storage key (finalUserPhoneNumber or finalVapiCallId is missing).');
    return res.status(400).json({
      toolCallId: toolCallIdForResponse,
      result: "Error: Cannot store pending transfer, critical identifiers are missing."
    });
  }

  // Store the information
  pendingTransfers[storageKey] = {
    departmentName,
    vapiCallId: finalVapiCallId, // Store the most reliable VAPI call ID
    userPhoneNumber: finalUserPhoneNumber || 'N/A',
    timestamp: new Date().toISOString(),
    status: 'pending_vapi_transfer_to_twilio'
  };

  console.log(`Prepared for sequential transfer for storageKey '${storageKey}' to department: ${departmentName}`);
  console.log('Current pendingTransfers:', JSON.stringify(pendingTransfers, null, 2));

  // Send success response back to VAPI
  res.status(200).json({
    toolCallId: toolCallIdForResponse, // Crucial: use the ID from VAPI's request
    result: `Successfully prepared for transfer to ${departmentName}. Ready for call.`
  });
});


// --- Start the server ---
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
  console.log('Press Ctrl+C to stop the server.');
  if (process.env.YOUR_RENDER_APP_BASE_URL && process.env.YOUR_RENDER_APP_BASE_URL !== `http://localhost:${PORT}`) {
    console.log(`Once deployed, it should be accessible at ${process.env.YOUR_RENDER_APP_BASE_URL}`);
  }
});

// Export the app (optional, but can be useful for testing frameworks later)
module.exports = app;
