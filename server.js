// Import necessary modules
const express = require('express');
const dotenv = require('dotenv');
const twilio = require('twilio');

// Load environment variables from .env file
dotenv.config();

// --- Twilio Client Initialization ---
const twilioAccountSid = process.env.TWILIO_ACCOUNT_SID;
const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
const twilioClient = twilio(twilioAccountSid, twilioAuthToken);
const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER; // Your Twilio number for outbound calls

// --- Application Configuration ---
// Hardcoded specialist sequences with E.164 phone numbers
const departmentSpecialists = {
    "New quote": [
        "+12485617008", // Ellen Satterlee
        "+13133994107", // Colleen Loudon
        "+18123441441", // Amit Soman
        "+17346647791"  // Mark Woster
    ],
    "Current Projects": [
        "+13133994107", // Colleen Loudon
        "+17347482539", // Carrie Lazorishchak
        "+17346647791", // Mark Woster
        "+18123441441"  // Amit Soman
    ],
    "Shipping and receiving": [
        "+12488370972", // April Streetman
        "+17346647791", // Mark Woster
        "+13136559375", // Chris Green
        "+12489261575"  // Chris Flora
    ],
    "Accounting related questions": [
        "+17343947378", // Aymee Steiner
        "+17347767417", // Janice Fosterling
        "+18123441441"  // Amit Soman
    ],
    "Purchasing": [
        "+12485679028", // Marcela Avila
        "+17346647791", // Mark Woster
        "+18123441441"  // Amit Soman
    ],
    "High priority": [
        "+17346647791", // Mark Woster
        "+18123441441", // Amit Soman
        "+12488370972", // April Streetman
        "+17343947378"  // Aymee Steiner
    ]
};

// Temporary in-memory store for pending transfers initiated by VAPI
const pendingVapiRequests = {};

// Temporary in-memory store for active sequential transfer sessions managed by Twilio
const activeSequentialTransfers = {};

// Initialize the Express application
const app = express();

// Middleware
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

const PORT = process.env.PORT || 3000;

app.get('/health', (req, res) => {
  console.log('Health check endpoint was hit!');
  res.status(200).json({ status: 'UP', message: 'Server is healthy' });
});

// Endpoint VAPI calls to prepare for a transfer
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
    const responseToolCallId = toolCallIdForResponse || "unknown_tool_call_id_in_error";
    return res.status(500).json({
        results: [{ 
            toolCallId: responseToolCallId,
            result: "Internal server error during request processing."
        }]
    });
  }

  if (!departmentName) {
    console.error('CRITICAL_VALIDATION_FAILURE: departmentName is missing or invalid. Cannot proceed.');
    return res.status(400).json({
      results: [{ 
          toolCallId: toolCallIdForResponse,
          result: "Error: Missing or invalid 'departmentName' parameter from VAPI's tool call."
      }]
    });
  }

  if (!actualVapiCallId) {
    console.error("CRITICAL_VALIDATION_FAILURE: actualVapiCallId could not be determined. Cannot proceed.");
    return res.status(400).json({
      results: [{ 
          toolCallId: toolCallIdForResponse,
          result: "Error: Critical identifier 'vapiCallId' could not be determined from request payload."
      }]
    });
  }

  const storageKey = actualUserPhoneNumber || actualVapiCallId; 
  pendingVapiRequests[storageKey] = { 
    departmentName: departmentName,
    vapiCallId: actualVapiCallId,
    userPhoneNumber: actualUserPhoneNumber || 'N/A',
    timestamp: new Date().toISOString(),
    status: 'pending_vapi_transfer_to_twilio'
  };

  console.log(`SUCCESS_PROCESS: Prepared for sequential transfer for storageKey '${storageKey}' to department: ${departmentName}`);
  console.log('Current pendingVapiRequests:', JSON.stringify(pendingVapiRequests, null, 2));

  res.status(200).json({
    results: [{ 
        toolCallId: toolCallIdForResponse, 
        result: `Successfully prepared for transfer to ${departmentName}. Ready for call.`
    }]
  });
});

// --- Twilio Inbound Call Endpoint (after VAPI transfers to this number) ---
app.post('/twilio/voice/inbound-sequential-entry', async (req, res) => {
  const userTwilioCallSid = req.body.CallSid;
  const fromUserPhoneNumber = req.body.From; // This is the end-user's phone number

  console.log(`--- /twilio/voice/inbound-sequential-entry: Call from ${fromUserPhoneNumber}, Twilio CallSid: ${userTwilioCallSid} ---`);
  console.log('Twilio Request Body:', JSON.stringify(req.body, null, 2));

  const pendingRequest = pendingVapiRequests[fromUserPhoneNumber];
  const twiml = new twilio.twiml.VoiceResponse();

  if (pendingRequest && departmentSpecialists[pendingRequest.departmentName]) {
    console.log(`Found pending VAPI request for ${fromUserPhoneNumber}: Dept: ${pendingRequest.departmentName}`);
    const { departmentName, vapiCallId } = pendingRequest;
    const specialists = departmentSpecialists[departmentName]; // Array of numbers

    if (specialists && specialists.length > 0) {
      const conferenceName = `conf_${userTwilioCallSid}`;
      
      activeSequentialTransfers[userTwilioCallSid] = {
        departmentName,
        vapiCallId,
        originalUserPhoneNumber: fromUserPhoneNumber,
        specialistList: specialists,
        currentIndex: 0,
        conferenceName,
        status: 'dialing_specialist_0' // Status indicates which specialist index
      };
      console.log('Active Sequential Transfers State Updated:', JSON.stringify(activeSequentialTransfers[userTwilioCallSid], null, 2));

      twiml.say(`Connecting you to the ${departmentName} department. Please hold while we find an available specialist.`);
      const dial = twiml.dial();
      dial.conference({
          waitUrl: 'http://twimlets.com/holdmusic?Bucket=com.twilio.music.classical',
          startConferenceOnEnter: true,
          endConferenceOnExit: false 
      }, conferenceName);
      
      delete pendingVapiRequests[fromUserPhoneNumber];
      console.log(`Cleaned up pendingVapiRequests for ${fromUserPhoneNumber}`);

      const baseUrl = process.env.YOUR_RENDER_APP_BASE_URL || `http://localhost:${PORT}`;
      // URL for the specialist to join the conference
      const specialistJoinUrl = `${baseUrl}/twilio/voice/specialist-join-conference?confName=${encodeURIComponent(conferenceName)}`;
      // URL for Twilio to send status updates about the call to the specialist
      const specialistStatusCallbackUrl = `${baseUrl}/twilio/voice/specialist-status?userCallSid=${encodeURIComponent(userTwilioCallSid)}&confName=${encodeURIComponent(conferenceName)}&specialistIndex=0`; // specialistIndex instead of currentIndex for clarity
      
      console.log(`Dialing first specialist: ${specialists[0]} for conference: ${conferenceName}`);
      console.log(`Specialist Join URL: ${specialistJoinUrl}`);
      console.log(`Specialist Status Callback URL: ${specialistStatusCallbackUrl}`);

      try {
        if (!twilioPhoneNumber) {
            console.error("CRITICAL: TWILIO_PHONE_NUMBER (for outbound calls) is not set in environment variables.");
            // Potentially play an error to the user in conference or hangup.
            // For now, we just log and the TwiML will put them on hold.
        } else {
            await twilioClient.calls.create({
              to: specialists[0],
              from: twilioPhoneNumber,
              url: specialistJoinUrl, 
              method: 'POST',
              statusCallback: specialistStatusCallbackUrl,
              statusCallbackMethod: 'POST',
              statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed']
            });
            console.log(`Successfully initiated call to first specialist: ${specialists[0]}`);
        }
      } catch (error) {
        console.error(`Error calling first specialist ${specialists[0]}:`, error.message);
      }

    } else {
      console.warn(`No specialists configured or found for department: ${departmentName}`);
      twiml.say(`Sorry, there are no specialists configured for the ${departmentName} department at the moment.`);
      twiml.hangup();
    }
  } else {
    console.warn(`No pending VAPI request found for user: ${fromUserPhoneNumber} or department not in specialist list. This call might be unexpected.`);
    twiml.say("Sorry, we couldn't find your pending transfer request or the department is misconfigured. Please try calling back or contact support directly.");
    twiml.hangup();
  }

  res.type('text/xml');
  res.send(twiml.toString());
});


// --- Start the server ---
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
  console.log('Press Ctrl+C to stop the server.');
  if (process.env.YOUR_RENDER_APP_BASE_URL && process.env.YOUR_RENDER_APP_BASE_URL !== `http://localhost:${PORT}`) {
    console.log(`Once deployed, it should be accessible at ${process.env.YOUR_RENDER_APP_BASE_URL}`);
  }
});

module.exports = app;
