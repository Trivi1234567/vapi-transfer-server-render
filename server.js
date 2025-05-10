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
const appBaseUrl = process.env.YOUR_RENDER_APP_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;

// --- Application Configuration ---
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

const pendingVapiRequests = {}; 
const activeSequentialTransfers = {}; 

const app = express();

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

const PORT = process.env.PORT || 3000;

app.get('/health', (req, res) => {
  console.log(`${new Date().toISOString()} [HEALTH] Health check endpoint was hit!`);
  res.status(200).json({ status: 'UP', message: 'Server is healthy' });
});

// Endpoint VAPI calls to prepare for a transfer
app.post('/api/vapi/prepare-sequential-transfer', (req, res) => {
  const requestTime = new Date().toISOString();
  console.log(`--- ${requestTime} [VAPI_PREPARE] New Request ---`);
  try {
    console.log(`[VAPI_PREPARE] Request Body (stringified):`, JSON.stringify(req.body, null, 2));
  } catch (e) {
    console.error(`[VAPI_PREPARE] Error stringifying req.body:`, e);
  }

  let departmentName;
  let actualVapiCallId;
  let actualUserPhoneNumber;
  let toolCallIdForResponse = "unknown_tool_call_id"; 

  try {
    const body = req.body; 

    if (body && body.message) {
      const message = body.message;

      if (message.toolCallList && Array.isArray(message.toolCallList) && message.toolCallList.length > 0) {
        const firstToolCall = message.toolCallList[0];
        if (firstToolCall && firstToolCall.id) {
          toolCallIdForResponse = firstToolCall.id;
          console.log(`[VAPI_PREPARE] SUCCESS: Extracted toolCallIdForResponse: ${toolCallIdForResponse}`);
        } else { console.warn('[VAPI_PREPARE] WARNING: message.toolCallList[0].id missing.'); }

        if (firstToolCall && firstToolCall.function && firstToolCall.function.arguments) {
          const toolArgs = firstToolCall.function.arguments;
          departmentName = toolArgs.departmentName || toolArgs.department_name; 
          if (departmentName) {
              console.log(`[VAPI_PREPARE] SUCCESS: Extracted departmentName from LLM args: '${departmentName}'`);
          } else { console.warn('[VAPI_PREPARE] WARNING: departmentName (or department_name) not found in toolCallList args.');}
        } else { console.warn('[VAPI_PREPARE] WARNING: message.toolCallList[0].function.arguments missing.');}
      } else { console.warn('[VAPI_PREPARE] WARNING: body.message.toolCallList is not as expected.'); }

      if (message.call && typeof message.call === 'object' && message.call !== null) {
        const messageCallObject = message.call;
        console.log(`[VAPI_PREPARE] INFO: Found body.message.call. Keys: ${Object.keys(messageCallObject).join(', ')}`);
        if (messageCallObject.id && typeof messageCallObject.id === 'string' && messageCallObject.id.trim() !== '') {
          actualVapiCallId = messageCallObject.id;
          console.log(`[VAPI_PREPARE] SUCCESS: Extracted actualVapiCallId from body.message.call.id: '${actualVapiCallId}'`);
        } else { console.warn(`[VAPI_PREPARE] WARNING: body.message.call.id is missing/invalid. Value: '${messageCallObject.id}'`); }

        if (messageCallObject.customer && typeof messageCallObject.customer === 'object' && messageCallObject.customer !== null &&
            messageCallObject.customer.number && typeof messageCallObject.customer.number === 'string' && messageCallObject.customer.number.trim() !== '') {
          actualUserPhoneNumber = messageCallObject.customer.number;
          console.log(`[VAPI_PREPARE] SUCCESS: Extracted actualUserPhoneNumber from body.message.call.customer.number: '${actualUserPhoneNumber}'`);
        } else {
          console.warn(`[VAPI_PREPARE] WARNING: body.message.call.customer.number is missing/invalid. Value: ${messageCallObject.customer ? messageCallObject.customer.number : 'customer object missing'}`);
        }
      } else { 
          console.warn('[VAPI_PREPARE] WARNING: body.message.call not found or invalid. Checking top-level body.call as fallback.');
          if (body && body.call && typeof body.call === 'object' && body.call !== null) {
            const topLevelCallObject = body.call;
            console.log(`[VAPI_PREPARE] INFO (Fallback): Found top-level body.call. Keys: ${Object.keys(topLevelCallObject).join(', ')}`);
            if (topLevelCallObject.id && typeof topLevelCallObject.id === 'string' && topLevelCallObject.id.trim() !== '') {
                actualVapiCallId = topLevelCallObject.id;
                console.log(`[VAPI_PREPARE] SUCCESS (Fallback): Extracted actualVapiCallId from top-level body.call.id: '${actualVapiCallId}'`);
            }
             if (topLevelCallObject.customer && typeof topLevelCallObject.customer === 'object' && topLevelCallObject.customer !== null &&
                topLevelCallObject.customer.number && typeof topLevelCallObject.customer.number === 'string' && topLevelCallObject.customer.number.trim() !== '') {
                actualUserPhoneNumber = topLevelCallObject.customer.number;
                console.log(`[VAPI_PREPARE] SUCCESS (Fallback): Extracted actualUserPhoneNumber from top-level body.call.customer.number: '${actualUserPhoneNumber}'`);
            }
          } else {
            console.warn('[VAPI_PREPARE] WARNING (Fallback): Top-level body.call also not found or invalid.');
          }
      }
    } else { console.warn('[VAPI_PREPARE] CRITICAL WARNING: Top-level "message" object missing in VAPI payload.'); }
    
    if (!actualUserPhoneNumber) actualUserPhoneNumber = null;

  } catch (e) {
    console.error('[VAPI_PREPARE] !!! UNEXPECTED ERROR during data extraction !!!:', e.message, e.stack);
    const responseToolCallId = toolCallIdForResponse || "unknown_tool_call_id_in_error";
    return res.status(500).json({ results: [{ toolCallId: responseToolCallId, result: "Internal server error during request processing." }] });
  }

  if (!departmentName) {
    console.error('[VAPI_PREPARE] CRITICAL_VALIDATION_FAILURE: departmentName is missing. Responding 400.');
    return res.status(400).json({ results: [{ toolCallId: toolCallIdForResponse, result: "Error: Missing 'departmentName' parameter." }] });
  }
  if (!actualVapiCallId) {
    console.error("[VAPI_PREPARE] CRITICAL_VALIDATION_FAILURE: actualVapiCallId could not be determined. Responding 400.");
    return res.status(400).json({ results: [{ toolCallId: toolCallIdForResponse, result: "Error: Critical 'vapiCallId' could not be determined." }] });
  }

  const storageKey = actualUserPhoneNumber || actualVapiCallId; 
  pendingVapiRequests[storageKey] = { 
    departmentName: departmentName, vapiCallId: actualVapiCallId,
    userPhoneNumber: actualUserPhoneNumber || 'N/A', timestamp: new Date().toISOString(),
    status: 'pending_vapi_transfer_to_twilio'
  };
  console.log(`[VAPI_PREPARE] SUCCESS_PROCESS: Prepared for storageKey '${storageKey}' to department: ${departmentName}`);
  console.log('[VAPI_PREPARE] Current pendingVapiRequests:', JSON.stringify(pendingVapiRequests, null, 2));
  res.status(200).json({ results: [{ toolCallId: toolCallIdForResponse, result: `Successfully prepared for transfer to ${departmentName}. Ready for call.` }] });
});

app.post('/twilio/voice/inbound-sequential-entry', async (req, res) => {
  const userTwilioCallSid = req.body.CallSid;
  const fromUserPhoneNumber = req.body.From; 
  const requestTime = new Date().toISOString();
  console.log(`--- ${requestTime} [TWILIO_INBOUND] Call from ${fromUserPhoneNumber}, Twilio CallSid: ${userTwilioCallSid} ---`);
  console.log('[TWILIO_INBOUND] Twilio Request Body:', JSON.stringify(req.body, null, 2));

  const pendingRequest = pendingVapiRequests[fromUserPhoneNumber];
  const twiml = new twilio.twiml.VoiceResponse();

  if (pendingRequest && departmentSpecialists[pendingRequest.departmentName]) {
    console.log(`[TWILIO_INBOUND] Found pending VAPI request for ${fromUserPhoneNumber}: Dept: ${pendingRequest.departmentName}`);
    const { departmentName, vapiCallId } = pendingRequest;
    const specialists = departmentSpecialists[departmentName]; 

    if (specialists && specialists.length > 0) {
      const conferenceName = `conf_${userTwilioCallSid}`;
      activeSequentialTransfers[userTwilioCallSid] = {
        departmentName, vapiCallId, originalUserPhoneNumber: fromUserPhoneNumber,
        specialistList: specialists, currentIndex: 0, conferenceName,
        status: 'dialing_specialist_0' 
      };
      console.log('[TWILIO_INBOUND] Active Sequential Transfers State Updated:', JSON.stringify(activeSequentialTransfers[userTwilioCallSid], null, 2));

      twiml.say(`Connecting you to the ${departmentName} department. Please hold while we find an available specialist.`);
      const dial = twiml.dial();
      dial.conference({
          waitUrl: 'http://twimlets.com/holdmusic?Bucket=com.twilio.music.classical',
          startConferenceOnEnter: true, endConferenceOnExit: false 
      }, conferenceName);
      
      delete pendingVapiRequests[fromUserPhoneNumber];
      console.log(`[TWILIO_INBOUND] Cleaned up pendingVapiRequests for ${fromUserPhoneNumber}`);

      const specialistJoinUrl = `${appBaseUrl}/twilio/voice/specialist-join-conference?confName=${encodeURIComponent(conferenceName)}`;
      const specialistStatusCallbackUrl = `${appBaseUrl}/twilio/voice/specialist-status?userCallSid=${encodeURIComponent(userTwilioCallSid)}&confName=${encodeURIComponent(conferenceName)}&specialistIndex=0`; 
      
      console.log(`[TWILIO_INBOUND] Dialing first specialist: ${specialists[0]} for conference: ${conferenceName}`);
      console.log(`[TWILIO_INBOUND] Specialist Join URL: ${specialistJoinUrl}`);
      console.log(`[TWILIO_INBOUND] Specialist Status Callback URL: ${specialistStatusCallbackUrl}`);

      try {
        if (!twilioPhoneNumber) {
            console.error("[TWILIO_INBOUND] CRITICAL: TWILIO_PHONE_NUMBER (for outbound calls) is not set.");
        } else {
            await twilioClient.calls.create({
              to: specialists[0], from: twilioPhoneNumber, url: specialistJoinUrl, 
              method: 'POST', statusCallback: specialistStatusCallbackUrl,
              statusCallbackMethod: 'POST', statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed']
            });
            console.log(`[TWILIO_INBOUND] Successfully initiated call to first specialist: ${specialists[0]}`);
        }
      } catch (error) { console.error(`[TWILIO_INBOUND] Error calling first specialist ${specialists[0]}:`, error.message, error.stack); }
    } else {
      console.warn(`[TWILIO_INBOUND] No specialists configured or found for department: ${departmentName}`);
      twiml.say(`Sorry, no specialists are configured for the ${departmentName} department at the moment.`);
      twiml.hangup();
    }
  } else {
    console.warn(`[TWILIO_INBOUND] No pending VAPI request for ${fromUserPhoneNumber} or department misconfigured. Pending: ${JSON.stringify(pendingRequest)}, Dept: ${pendingRequest ? pendingRequest.departmentName : 'N/A'}`);
    twiml.say("Sorry, we couldn't process your transfer request. Please try again.");
    twiml.hangup();
  }
  res.type('text/xml');
  res.send(twiml.toString());
});

app.post('/twilio/voice/specialist-join-conference', (req, res) => {
  const conferenceName = req.query.confName; 
  const requestTime = new Date().toISOString();
  console.log(`--- ${requestTime} [TWILIO_JOIN_CONF] Specialist joining: ${conferenceName} ---`);
  console.log('[TWILIO_JOIN_CONF] Request Query:', JSON.stringify(req.query, null, 2));
  console.log('[TWILIO_JOIN_CONF] Request Body:', JSON.stringify(req.body, null, 2)); 

  const twiml = new twilio.twiml.VoiceResponse();
  if (conferenceName) {
    const dial = twiml.dial();
    dial.conference({ startConferenceOnEnter: true, endConferenceOnExit: true }, conferenceName);
  } else {
    console.error("[TWILIO_JOIN_CONF] CRITICAL: Conference name missing.");
    twiml.say("Error: Conference identifier missing.");
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
  const requestTime = new Date().toISOString();

  console.log(`--- ${requestTime} [TWILIO_SPECIALIST_STATUS] UserCallSid: ${userCallSid}, SpecialistIdx: ${specialistIndex} ---`);
  console.log(`[TWILIO_SPECIALIST_STATUS] Specialist CallSid: ${specialistCallSid}, Status: ${callStatus}, AnsweredBy: ${answeredBy}, DialCallStatus: ${req.body.DialCallStatus}, Duration: ${req.body.Duration}`);
  console.log('[TWILIO_SPECIALIST_STATUS] Twilio Status Callback Body:', JSON.stringify(req.body, null, 2));

  const transferSession = activeSequentialTransfers[userCallSid];

  if (!transferSession) {
    console.error(`[TWILIO_SPECIALIST_STATUS] CRITICAL: No active transfer session for userCallSid: ${userCallSid}.`);
    return res.status(200).send(); 
  }
  
  const callWasAnsweredAndHuman = (callStatus === 'completed' && parseInt(req.body.Duration, 10) > 0 && (!answeredBy || (answeredBy && answeredBy.toLowerCase() === 'human'))) ||
                                (callStatus === 'in-progress' && (!answeredBy || (answeredBy && answeredBy.toLowerCase() === 'human')));


  if (callWasAnsweredAndHuman) {
    console.log(`[TWILIO_SPECIALIST_STATUS] SUCCESS: Specialist ${transferSession.specialistList[specialistIndex]} (idx ${specialistIndex}) answered conference ${conferenceName}.`);
    activeSequentialTransfers[userCallSid].status = `specialist_${specialistIndex}_joined`;
  } else {
    console.log(`[TWILIO_SPECIALIST_STATUS] INFO: Specialist ${transferSession.specialistList[specialistIndex]} (idx ${specialistIndex}) failed. Status: ${callStatus}, DialCallStatus: ${req.body.DialCallStatus}, AnsweredBy: ${answeredBy}.`);
    const nextSpecialistIndex = specialistIndex + 1;

    if (nextSpecialistIndex < transferSession.specialistList.length) {
      console.log(`[TWILIO_SPECIALIST_STATUS] Attempting next specialist (idx ${nextSpecialistIndex}): ${transferSession.specialistList[nextSpecialistIndex]}`);
      activeSequentialTransfers[userCallSid].currentIndex = nextSpecialistIndex;
      activeSequentialTransfers[userCallSid].status = `dialing_specialist_${nextSpecialistIndex}`;

      const nextSpecialistJoinUrl = `${appBaseUrl}/twilio/voice/specialist-join-conference?confName=${encodeURIComponent(conferenceName)}`;
      const nextSpecialistStatusCallbackUrl = `${appBaseUrl}/twilio/voice/specialist-status?userCallSid=${encodeURIComponent(userCallSid)}&confName=${encodeURIComponent(conferenceName)}&specialistIndex=${nextSpecialistIndex}`;
      
      try {
        if (!twilioPhoneNumber) {
            console.error("[TWILIO_SPECIALIST_STATUS] CRITICAL: TWILIO_PHONE_NUMBER not set for next specialist call.");
        } else {
            await twilioClient.calls.create({
              to: transferSession.specialistList[nextSpecialistIndex], from: twilioPhoneNumber, url: nextSpecialistJoinUrl,
              method: 'POST', statusCallback: nextSpecialistStatusCallbackUrl,
              statusCallbackMethod: 'POST', statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed']
            });
            console.log(`[TWILIO_SPECIALIST_STATUS] Successfully initiated call to next specialist: ${transferSession.specialistList[nextSpecialistIndex]}`);
        }
      } catch (error) { console.error(`[TWILIO_SPECIALIST_STATUS] Error calling next specialist ${transferSession.specialistList[nextSpecialistIndex]}:`, error.message, error.stack); }
    } else {
      console.log(`[TWILIO_SPECIALIST_STATUS] INFO: All specialists tried for department ${transferSession.departmentName} for userCallSid ${userCallSid}.`);
      activeSequentialTransfers[userCallSid].status = 'all_specialists_failed';
      console.log("[TWILIO_SPECIALIST_STATUS] VOICEMAIL FALLBACK TO BE IMPLEMENTED HERE.");
      // TODO: Implement voicemail logic 
    }
  }
  console.log('[TWILIO_SPECIALIST_STATUS] Updated Active Transfer Session:', JSON.stringify(activeSequentialTransfers[userCallSid], null, 2));
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
