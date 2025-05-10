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
const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER; 
const appBaseUrl = process.env.YOUR_RENDER_APP_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;

// --- Application Configuration ---
const departmentSpecialists = {
    "New quote": ["+12485617008", "+13133994107", "+18123441441", "+17346647791"],
    "Current Projects": ["+13133994107", "+17347482539", "+17346647791", "+18123441441"],
    "Shipping and receiving": ["+12488370972", "+17346647791", "+13136559375", "+12489261575"],
    "Accounting related questions": ["+17343947378", "+17347767417", "+18123441441"],
    "Purchasing": ["+12485679028", "+17346647791", "+18123441441"],
    "High priority": ["+17346647791", "+18123441441", "+12488370972", "+17343947378"]
};

const pendingVapiRequests = {};
const activeSequentialTransfers = {};

const app = express();

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

    if (body && body.message) {
      const message = body.message; // Work with the message object

      // 1. Extract toolCallIdForResponse and departmentName from message.toolCallList
      if (message.toolCallList && Array.isArray(message.toolCallList) && message.toolCallList.length > 0) {
        const firstToolCall = message.toolCallList[0];
        if (firstToolCall && firstToolCall.id) {
          toolCallIdForResponse = firstToolCall.id;
          console.log(`SUCCESS: Extracted toolCallIdForResponse from message.toolCallList[0].id: ${toolCallIdForResponse}`);
        } else { console.warn('WARNING: message.toolCallList[0].id missing.'); }

        if (firstToolCall && firstToolCall.function && firstToolCall.function.arguments) {
          const toolArgs = firstToolCall.function.arguments;
          departmentName = toolArgs.departmentName || toolArgs.department_name; 
          if (departmentName) {
              console.log(`SUCCESS: Extracted departmentName from LLM args: '${departmentName}'`);
          } else { console.warn('WARNING: departmentName (or department_name) not found in toolCallList args.');}
        } else { console.warn('WARNING: message.toolCallList[0].function.arguments missing.');}
      } else { console.warn('WARNING: body.message.toolCallList is not as expected.'); }

      // 2. Extract actualVapiCallId and actualUserPhoneNumber from body.message.call
      console.log("--- Debugging body.message.call ---");
      if (message.call && typeof message.call === 'object' && message.call !== null) {
        const messageCallObject = message.call;
        console.log(`SUCCESS: body.message.call is an object. Keys: ${Object.keys(messageCallObject).join(', ')}`);
        
        if (messageCallObject.id && typeof messageCallObject.id === 'string' && messageCallObject.id.trim() !== '') {
          actualVapiCallId = messageCallObject.id;
          console.log(`SUCCESS: Extracted actualVapiCallId from body.message.call.id: '${actualVapiCallId}'`);
        } else { console.warn(`WARNING: body.message.call.id is missing/invalid. Value: '${messageCallObject.id}'`); }

        if (messageCallObject.customer && typeof messageCallObject.customer === 'object' && messageCallObject.customer !== null &&
            messageCallObject.customer.number && typeof messageCallObject.customer.number === 'string' && messageCallObject.customer.number.trim() !== '') {
          actualUserPhoneNumber = messageCallObject.customer.number;
          console.log(`SUCCESS: Extracted actualUserPhoneNumber from body.message.call.customer.number: '${actualUserPhoneNumber}'`);
        } else {
          console.warn(`WARNING: body.message.call.customer.number is missing/invalid. Value: ${messageCallObject.customer ? messageCallObject.customer.number : 'customer object missing in message.call'}`);
        }
      } else { console.warn('WARNING: body.message.call not found or invalid. This is the primary expected path for call context.'); }
    
    } else { // Fallback if top-level 'message' object is missing (very unlikely for tool calls)
        console.warn('CRITICAL WARNING: Top-level "message" object missing in VAPI payload.');
        if (body && body.toolCall && body.toolCall.toolCallId) { // Old fallback for toolCallId
            toolCallIdForResponse = body.toolCall.toolCallId;
            console.log(`SUCCESS (Fallback): Extracted toolCallIdForResponse from toolCall.toolCallId: ${toolCallIdForResponse}`);
            const params = body.toolCall.parameters || (body.toolCall.function && body.toolCall.function.arguments);
            if (params) {
                departmentName = params.departmentName || params.department_name;
                if (departmentName) { console.log(`SUCCESS (Fallback): Extracted departmentName: '${departmentName}'`); }
                else { console.warn('WARNING (Fallback): departmentName (or department_name) not found in toolCall params/args.');}
            } else { console.warn('WARNING (Fallback): No parameters or arguments found in toolCall.');}
        }
    }
    if (!actualUserPhoneNumber) actualUserPhoneNumber = null; // Ensure it's null if not found

  } catch (e) {
    console.error('!!! UNEXPECTED ERROR during data extraction !!!:', e.message, e.stack);
    const responseToolCallId = toolCallIdForResponse || "unknown_tool_call_id_in_error";
    return res.status(500).json({ results: [{ toolCallId: responseToolCallId, result: "Internal server error during request processing." }] });
  }

  if (!departmentName) {
    console.error('CRITICAL_VALIDATION_FAILURE: departmentName is missing or invalid. Cannot proceed.');
    return res.status(400).json({ results: [{ toolCallId: toolCallIdForResponse, result: "Error: Missing or invalid 'departmentName' parameter." }] });
  }
  if (!actualVapiCallId) {
    console.error("CRITICAL_VALIDATION_FAILURE: actualVapiCallId could not be determined. Cannot proceed.");
    return res.status(400).json({ results: [{ toolCallId: toolCallIdForResponse, result: "Error: Critical 'vapiCallId' could not be determined." }] });
  }

  const storageKey = actualUserPhoneNumber || actualVapiCallId; 
  pendingVapiRequests[storageKey] = { 
    departmentName: departmentName, vapiCallId: actualVapiCallId,
    userPhoneNumber: actualUserPhoneNumber || 'N/A', timestamp: new Date().toISOString(),
    status: 'pending_vapi_transfer_to_twilio'
  };
  console.log(`SUCCESS_PROCESS: Prepared for sequential transfer for storageKey '${storageKey}' to department: ${departmentName}`);
  console.log('Current pendingVapiRequests:', JSON.stringify(pendingVapiRequests, null, 2));
  res.status(200).json({ results: [{ toolCallId: toolCallIdForResponse, result: `Successfully prepared for transfer to ${departmentName}. Ready for call.` }] });
});

app.post('/twilio/voice/inbound-sequential-entry', async (req, res) => {
  const userTwilioCallSid = req.body.CallSid;
  const fromUserPhoneNumber = req.body.From; 
  console.log(`--- /twilio/voice/inbound-sequential-entry: Call from ${fromUserPhoneNumber}, Twilio CallSid: ${userTwilioCallSid} ---`);
  console.log('Twilio Request Body:', JSON.stringify(req.body, null, 2));

  const pendingRequest = pendingVapiRequests[fromUserPhoneNumber];
  const twiml = new twilio.twiml.VoiceResponse();

  if (pendingRequest && departmentSpecialists[pendingRequest.departmentName]) {
    console.log(`Found pending VAPI request for ${fromUserPhoneNumber}: Dept: ${pendingRequest.departmentName}`);
    const { departmentName, vapiCallId } = pendingRequest;
    const specialists = departmentSpecialists[departmentName]; 

    if (specialists && specialists.length > 0) {
      const conferenceName = `conf_${userTwilioCallSid}`;
      activeSequentialTransfers[userTwilioCallSid] = {
        departmentName, vapiCallId, originalUserPhoneNumber: fromUserPhoneNumber,
        specialistList: specialists, currentIndex: 0, conferenceName,
        status: 'dialing_specialist_0' 
      };
      console.log('Active Sequential Transfers State Updated:', JSON.stringify(activeSequentialTransfers[userTwilioCallSid], null, 2));

      twiml.say(`Connecting you to the ${departmentName} department. Please hold while we find an available specialist.`);
      const dial = twiml.dial();
      dial.conference({
          waitUrl: 'http://twimlets.com/holdmusic?Bucket=com.twilio.music.classical',
          startConferenceOnEnter: true, endConferenceOnExit: false 
      }, conferenceName);
      
      delete pendingVapiRequests[fromUserPhoneNumber];
      console.log(`Cleaned up pendingVapiRequests for ${fromUserPhoneNumber}`);

      const specialistJoinUrl = `${appBaseUrl}/twilio/voice/specialist-join-conference?confName=${encodeURIComponent(conferenceName)}`;
      const specialistStatusCallbackUrl = `${appBaseUrl}/twilio/voice/specialist-status?userCallSid=${encodeURIComponent(userTwilioCallSid)}&confName=${encodeURIComponent(conferenceName)}&specialistIndex=0`; 
      
      console.log(`Dialing first specialist: ${specialists[0]} for conference: ${conferenceName}`);
      console.log(`Specialist Join URL: ${specialistJoinUrl}`);
      console.log(`Specialist Status Callback URL: ${specialistStatusCallbackUrl}`);

      try {
        if (!twilioPhoneNumber) {
            console.error("CRITICAL: TWILIO_PHONE_NUMBER (for outbound calls) is not set in environment variables.");
        } else {
            await twilioClient.calls.create({
              to: specialists[0], from: twilioPhoneNumber, url: specialistJoinUrl, 
              method: 'POST', statusCallback: specialistStatusCallbackUrl,
              statusCallbackMethod: 'POST', statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed']
            });
            console.log(`Successfully initiated call to first specialist: ${specialists[0]}`);
        }
      } catch (error) { console.error(`Error calling first specialist ${specialists[0]}:`, error.message); }
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

app.post('/twilio/voice/specialist-join-conference', (req, res) => {
  const conferenceName = req.query.confName; 
  console.log(`--- /twilio/voice/specialist-join-conference: Specialist joining conference: ${conferenceName} ---`);
  console.log('Request Query:', JSON.stringify(req.query, null, 2));
  console.log('Request Body:', JSON.stringify(req.body, null, 2)); 

  const twiml = new twilio.twiml.VoiceResponse();
  if (conferenceName) {
    const dial = twiml.dial();
    dial.conference({ startConferenceOnEnter: true, endConferenceOnExit: true }, conferenceName);
  } else {
    console.error("CRITICAL: Conference name not provided to /twilio/voice/specialist-join-conference");
    twiml.say("Sorry, there was an error connecting you to the conference. Conference name missing.");
    twiml.hangup();
  }
  res.type('text/xml');
  res.send(twiml.toString());
});

app.post('/twilio/voice/specialist-status', async (req, res) => {
  const userCallSid = req.query.userCallSid; 
  const conferenceName = req.query.confName;
  const specialistIndex = parseInt(req.query.specialistIndex, 10);
  const specialistCallSid = req.body.CallSid; 
  const callStatus = req.body.CallStatus; 
  const answeredBy = req.body.AnsweredBy; 

  console.log(`--- /twilio/voice/specialist-status for userCallSid: ${userCallSid}, specialistIndex: ${specialistIndex} ---`);
  console.log(`Specialist CallSid: ${specialistCallSid}, Status: ${callStatus}, AnsweredBy: ${answeredBy}`);
  console.log('Twilio Status Callback Body:', JSON.stringify(req.body, null, 2));

  const transferSession = activeSequentialTransfers[userCallSid];

  if (!transferSession) {
    console.error(`CRITICAL: No active transfer session found for userCallSid: ${userCallSid}. Cannot process specialist status.`);
    return res.status(200).send(); 
  }
  
  const successfulConnection = callStatus === 'completed' && req.body.DialCallStatus !== 'no-answer' && req.body.DialCallStatus !== 'busy' && req.body.DialCallStatus !== 'failed' && req.body.DialCallStatus !== 'canceled' && (!answeredBy || (answeredBy && !answeredBy.startsWith('machine') && answeredBy !== 'fax' && answeredBy !== 'unknown'));
  
  if (successfulConnection) {
    console.log(`SUCCESS: Specialist ${transferSession.specialistList[specialistIndex]} (index ${specialistIndex}) answered and joined conference ${conferenceName}.`);
    activeSequentialTransfers[userCallSid].status = `specialist_${specialistIndex}_joined`;
  } else {
    console.log(`INFO: Specialist ${transferSession.specialistList[specialistIndex]} (index ${specialistIndex}) did not connect successfully. Status: ${callStatus}, DialCallStatus: ${req.body.DialCallStatus}, AnsweredBy: ${answeredBy}.`);
    const nextSpecialistIndex = specialistIndex + 1;

    if (nextSpecialistIndex < transferSession.specialistList.length) {
      console.log(`Attempting to dial next specialist (index ${nextSpecialistIndex}): ${transferSession.specialistList[nextSpecialistIndex]}`);
      activeSequentialTransfers[userCallSid].currentIndex = nextSpecialistIndex;
      activeSequentialTransfers[userCallSid].status = `dialing_specialist_${nextSpecialistIndex}`;

      const nextSpecialistJoinUrl = `${appBaseUrl}/twilio/voice/specialist-join-conference?confName=${encodeURIComponent(conferenceName)}`;
      const nextSpecialistStatusCallbackUrl = `${appBaseUrl}/twilio/voice/specialist-status?userCallSid=${encodeURIComponent(userCallSid)}&confName=${encodeURIComponent(conferenceName)}&specialistIndex=${nextSpecialistIndex}`;
      
      try {
        if (!twilioPhoneNumber) {
            console.error("CRITICAL: TWILIO_PHONE_NUMBER (for outbound calls) is not set in environment variables for next specialist call.");
        } else {
            await twilioClient.calls.create({
              to: transferSession.specialistList[nextSpecialistIndex], from: twilioPhoneNumber, url: nextSpecialistJoinUrl,
              method: 'POST', statusCallback: nextSpecialistStatusCallbackUrl,
              statusCallbackMethod: 'POST', statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed']
            });
            console.log(`Successfully initiated call to next specialist: ${transferSession.specialistList[nextSpecialistIndex]}`);
        }
      } catch (error) { console.error(`Error calling next specialist ${transferSession.specialistList[nextSpecialistIndex]}:`, error.message); }
    } else {
      console.log(`INFO: All specialists tried for department ${transferSession.departmentName} for userCallSid ${userCallSid}. No one answered.`);
      activeSequentialTransfers[userCallSid].status = 'all_specialists_failed';
      console.log("VOICEMAIL FALLBACK TO BE IMPLEMENTED HERE.");
    }
  }
  console.log('Updated Active Sequential Transfers State:', JSON.stringify(activeSequentialTransfers[userCallSid], null, 2));
  res.status(200).send(); 
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
  console.log('Press Ctrl+C to stop the server.');
  if (process.env.YOUR_RENDER_APP_BASE_URL && process.env.YOUR_RENDER_APP_BASE_URL !== `http://localhost:${PORT}`) {
    console.log(`Once deployed, it should be accessible at ${process.env.YOUR_RENDER_APP_BASE_URL}`);
  }
});

module.exports = app;
