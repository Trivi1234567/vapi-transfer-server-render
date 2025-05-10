// Import necessary modules
const express = require('express');
const dotenv = require('dotenv');

// Load environment variables from .env file
dotenv.config();

// Temporary in-memory store for pending transfers
// Key: userPhoneNumber (or vapiCallId if preferred and reliable for linking)
// Value: { departmentName, vapiCallId, timestamp }
// In a real production app, you'd use a database (e.g., Redis, PostgreSQL)
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

  // Extract data from VAPI's request
  // We expect VAPI to send something like:
  // req.body.toolCall.parameters.departmentName
  // req.body.toolCall.parameters.vapiCallId (or req.body.call.id)
  // req.body.toolCall.parameters.userPhoneNumber (or req.body.call.customer.number)
  // We will confirm the exact structure from the logs.

  let departmentName, vapiCallId, userPhoneNumber;

  // Tentative extraction based on common VAPI tool call structure
  if (req.body.toolCall && req.body.toolCall.parameters) {
    departmentName = req.body.toolCall.parameters.departmentName;
    vapiCallId = req.body.toolCall.parameters.vapiCallId; // This was what we defined in our tool
    userPhoneNumber = req.body.toolCall.parameters.userPhoneNumber;
  } else if (req.body.call && req.body.call.id) { // Fallback if structure is different
    departmentName = req.body.departmentName; // Assuming it might be top-level if not in toolCall.parameters
    vapiCallId = req.body.call.id;
    if (req.body.call.customer && req.body.call.customer.number) {
      userPhoneNumber = req.body.call.customer.number;
    }
  } else {
     // If the structure is completely different, log and send an error
    console.error('Unexpected request structure from VAPI:', req.body);
    return res.status(400).json({ 
      toolCallId: req.body.toolCall?.toolCallId, // Attempt to get toolCallId for response
      result: "Error: Malformed request or missing expected parameters (departmentName, vapiCallId)." 
    });
  }


  // Validate required parameters
  if (!departmentName || !vapiCallId) {
    console.error('Missing departmentName or vapiCallId in request from VAPI.');
    return res.status(400).json({
      toolCallId: req.body.toolCall?.toolCallId,
      result: `Error: Missing required parameters. Received departmentName: ${departmentName}, vapiCallId: ${vapiCallId}.`
    });
  }
  
  // If userPhoneNumber is missing, we might use vapiCallId as the primary key for pendingTransfers
  // For now, we'll try to use userPhoneNumber if available, otherwise vapiCallId.
  const storageKey = userPhoneNumber || vapiCallId;
  if (!storageKey) {
    console.error('Could not determine a storage key (userPhoneNumber or vapiCallId is missing).');
    return res.status(400).json({
      toolCallId: req.body.toolCall?.toolCallId,
      result: "Error: Cannot store pending transfer, userPhoneNumber or vapiCallId is missing."
    });
  }

  // Store the information
  pendingTransfers[storageKey] = {
    departmentName,
    vapiCallId,
    userPhoneNumber: userPhoneNumber || 'N/A', // Store it even if it wasn't the key
    timestamp: new Date().toISOString(),
    status: 'pending_vapi_transfer_to_twilio'
  };

  console.log(`Prepared for sequential transfer for ${storageKey} to department: ${departmentName}`);
  console.log('Current pendingTransfers:', JSON.stringify(pendingTransfers, null, 2));

  // Send success response back to VAPI
  // VAPI expects a 'result' field and the 'toolCallId' from its request.
  res.status(200).json({
    toolCallId: req.body.toolCall?.toolCallId, // Ensure you pass back the toolCallId VAPI sent
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
