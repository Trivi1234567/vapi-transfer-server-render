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
  console.log('Received request on /api/vapi/prepare-sequential-transfer');
  const requestBodyString = JSON.stringify(req.body, null, 2);
  console.log('Request Body from VAPI:', requestBodyString);

  let departmentNameFromLlmArgs;
  let vapiCallIdFromLlmArgs;
  let userPhoneNumberFromLlmArgs;
  let toolCallIdForResponse;

  // Corrected extraction of toolCallId and LLM arguments
  if (req.body.message && req.body.message.toolCallList && req.body.message.toolCallList.length > 0) {
    const firstToolCall = req.body.message.toolCallList[0];
    toolCallIdForResponse = firstToolCall.id;
    if (firstToolCall.function && firstToolCall.function.arguments) { // CORRECTED PATH
      const toolArguments = firstToolCall.function.arguments;
      departmentNameFromLlmArgs = toolArguments.departmentName;
      vapiCallIdFromLlmArgs = toolArguments.vapiCallId;
      userPhoneNumberFromLlmArgs = toolArguments.userPhoneNumber;
      console.log(`LLM Tool Arguments: departmentName='${departmentNameFromLlmArgs}', vapiCallIdFromLlmArgs='${vapiCallIdFromLlmArgs}', userPhoneNumberFromLlmArgs='${userPhoneNumberFromLlmArgs}'`);
    } else {
      console.warn('Tool arguments object missing in req.body.message.toolCallList[0].function.arguments');
    }
  } else if (req.body.toolCall && req.body.toolCall.toolCallId) { // Fallback for older structure
    toolCallIdForResponse = req.body.toolCall.toolCallId;
    if (req.body.toolCall.parameters) { // VAPI's older 'toolCall.parameters' structure
        const toolParameters = req.body.toolCall.parameters;
        departmentNameFromLlmArgs = toolParameters.departmentName;
        vapiCallIdFromLlmArgs = toolParameters.vapiCallId;
        userPhoneNumberFromLlmArgs = toolParameters.userPhoneNumber;
        console.log(`Legacy Tool Parameters: departmentName='${departmentNameFromLlmArgs}', vapiCallIdFromLlmArgs='${vapiCallIdFromLlmArgs}', userPhoneNumberFromLlmArgs='${userPhoneNumberFromLlmArgs}'`);
    } else if (req.body.toolCall.function && req.body.toolCall.function.arguments) { // Structure seen in user logs under 'toolWithToolCallList[0].toolCall'
        const toolArguments = req.body.toolCall.function.arguments;
        departmentNameFromLlmArgs = toolArguments.departmentName;
        vapiCallIdFromLlmArgs = toolArguments.vapiCallId;
        userPhoneNumberFromLlmArgs = toolArguments.userPhoneNumber;
        console.log(`Alternative ToolCall Structure Arguments: departmentName='${departmentNameFromLlmArgs}', vapiCallIdFromLlmArgs='${vapiCallIdFromLlmArgs}', userPhoneNumberFromLlmArgs='${userPhoneNumberFromLlmArgs}'`);
    } else {
        console.warn('Tool parameters/arguments object missing in req.body.toolCall');
    }
  }
  console.log(`Extracted toolCallIdForResponse: ${toolCallIdForResponse}`);

  // --- Determine actual identifiers with DETAILED LOGGING ---
  let actualVapiCallId;
  let actualUserPhoneNumber;

  console.log("--- Debugging Identifier Extraction ---");
  // Very direct check for req.body.call
  if (typeof req.body.call === 'object' && req.body.call !== null) {
    console.log(`1. req.body.call is an object. Keys: ${Object.keys(req.body.call).join(', ')}`);
    if (req.body.call.hasOwnProperty('id')) {
        console.log(`2. Checking req.body.call.id: Value='${req.body.call.id}', Type='${typeof req.body.call.id}'`);
        if (req.body.call.id && typeof req.body.call.id === 'string' && req.body.call.id.trim() !== '') {
            actualVapiCallId = req.body.call.id;
            console.log(`   SUCCESS: Using vapiCallId from req.body.call.id: ${actualVapiCallId}`);
        } else {
            console.log(`   INFO: req.body.call.id is present but not a non-empty string or is falsy.`);
        }
    } else {
        console.log(`   INFO: req.body.call does not have property 'id'.`);
    }
  } else {
    console.log(`1. req.body.call is NOT an object or is null. Value: ${req.body.call}, Type: ${typeof req.body.call}`);
  }


  if (!actualVapiCallId) { // If not set from req.body.call.id
    console.log(`4. Checking vapiCallIdFromLlmArgs: Value='${vapiCallIdFromLlmArgs}'`);
    if (vapiCallIdFromLlmArgs && typeof vapiCallIdFromLlmArgs === 'string' && vapiCallIdFromLlmArgs.toLowerCase() !== "call.id" && vapiCallIdFromLlmArgs.toLowerCase() !== "[call.id]" && vapiCallIdFromLlmArgs.trim() !== '') {
      actualVapiCallId = vapiCallIdFromLlmArgs;
      console.log(`   SUCCESS (Fallback): Using vapiCallId from LLM arguments: ${actualVapiCallId}`);
    } else {
      console.log(`   INFO: vapiCallIdFromLlmArgs ('${vapiCallIdFromLlmArgs}') is not a valid fallback.`);
    }
  }
  
  if (!actualVapiCallId) {
    console.error("CRITICAL: actualVapiCallId could not be determined. Responding with 400.");
    return res.status(400).json({
      toolCallId: toolCallIdForResponse || "unknown_tool_call_id", // Ensure toolCallIdForResponse is defined
      result: "Error: Critical identifier 'vapiCallId' could not be determined from request payload."
    });
  }

  // Determine actualUserPhoneNumber
  if (typeof req.body.call === 'object' && req.body.call !== null && req.body.call.hasOwnProperty('customer') && typeof req.body.call.customer === 'object' && req.body.call.customer !== null) {
    console.log(`5. req.body.call.customer is an object. Keys: ${Object.keys(req.body.call.customer).join(', ')}`);
    if (req.body.call.customer.hasOwnProperty('number')) {
        console.log(`6. Checking req.body.call.customer.number: Value='${req.body.call.customer.number}', Type='${typeof req.body.call.customer.number}'`);
        if (req.body.call.customer.number && typeof req.body.call.customer.number === 'string' && req.body.call.customer.number.trim() !== '') {
            actualUserPhoneNumber = req.body.call.customer.number;
            console.log(`   SUCCESS: Using userPhoneNumber from req.body.call.customer.number: ${actualUserPhoneNumber}`);
        } else {
            console.log(`   INFO: req.body.call.customer.number is present but not a non-empty string or is falsy.`);
        }
    } else {
        console.log(`   INFO: req.body.call.customer does not have property 'number'.`);
    }
  } else {
    console.log(`5. req.body.call.customer is NOT an object, is null, or req.body.call is not an object/is null.`);
  }


  if (!actualUserPhoneNumber) { // If not set from req.body.call.customer.number
    console.log(`7. Checking userPhoneNumberFromLlmArgs: Value='${userPhoneNumberFromLlmArgs}'`);
    if (userPhoneNumberFromLlmArgs && typeof userPhoneNumberFromLlmArgs === 'string' && userPhoneNumberFromLlmArgs.toLowerCase() !== "call.customer.number" && userPhoneNumberFromLlmArgs.toLowerCase() !== "[call.customer.number]" && userPhoneNumberFromLlmArgs.trim() !== '') {
      actualUserPhoneNumber = userPhoneNumberFromLlmArgs;
      console.log(`   SUCCESS (Fallback): Using userPhoneNumber from LLM arguments: ${actualUserPhoneNumber}`);
    } else {
      console.log(`   INFO: userPhoneNumberFromLlmArgs ('${userPhoneNumberFromLlmArgs}') is not a valid fallback. User phone number will be 'N/A'.`);
      actualUserPhoneNumber = null; 
    }
  }
  console.log("--- End Debugging Identifier Extraction ---");
  
  const finalDepartmentName = departmentNameFromLlmArgs;

  if (!finalDepartmentName) {
    console.error('CRITICAL: departmentName is missing in the request from VAPI tool arguments.');
    return res.status(400).json({
      toolCallId: toolCallIdForResponse || "unknown_tool_call_id",
      result: `Error: Missing required 'departmentName' parameter from VAPI. Cannot proceed.`
    });
  }

  const storageKey = actualUserPhoneNumber || actualVapiCallId; 

  pendingTransfers[storageKey] = {
    departmentName: finalDepartmentName,
    vapiCallId: actualVapiCallId,
    userPhoneNumber: actualUserPhoneNumber || 'N/A',
    timestamp: new Date().toISOString(),
    status: 'pending_vapi_transfer_to_twilio'
  };

  console.log(`Prepared for sequential transfer for storageKey '${storageKey}' to department: ${finalDepartmentName}`);
  console.log('Current pendingTransfers:', JSON.stringify(pendingTransfers, null, 2));

  res.status(200).json({
    toolCallId: toolCallIdForResponse, // Ensure this is defined
    result: `Successfully prepared for transfer to ${finalDepartmentName}. Ready for call.`
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
