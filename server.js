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

    if (body && body.message && body.message.toolCallList && Array.isArray(body.message.toolCallList) && body.message.toolCallList.length > 0) {
      const firstToolCall = body.message.toolCallList[0];
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
    } else {
      console.warn('WARNING: body.message.toolCallList is not as expected. Attempting fallback.');
      if (body && body.toolCall && body.toolCall.toolCallId) { 
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

    if (body && body.message && body.message.call && typeof body.message.call === 'object' && body.message.call !== null) {
      const messageCallObject = body.message.call;
      console.log(`INFO: Found body.message.call. Keys: ${Object.keys(messageCallObject).join(', ')}`);
      if (messageCallObject.id && typeof messageCallObject.id === 'string' && messageCallObject.id.trim() !== '') {
        actualVapiCallId = messageCallObject.id;
        console.log(`SUCCESS: Extracted actualVapiCallId from body.message.call.id: '${actualVapiCallId}'`);
      } else { console.warn(`WARNING: body.message.call.id is missing/invalid. Value: '${messageCallObject.id}'`);}
      if (messageCallObject.customer && typeof messageCallObject.customer === 'object' && messageCallObject.customer !== null &&
          messageCallObject.customer.number && typeof messageCallObject.customer.number === 'string' && messageCallObject.customer.number.trim() !== '') {
        actualUserPhoneNumber = messageCallObject.customer.number;
        console.log(`SUCCESS: Extracted actualUserPhoneNumber from body.message.call.customer.number: '${actualUserPhoneNumber}'`);
      } else {
        console.warn(`WARNING: body.message.call.customer.number is missing/invalid. Value: ${messageCallObject.customer ? messageCallObject.customer.number : 'customer object missing'}`);
        actualUserPhoneNumber = null;
      }
    } else {
      console.warn('WARNING: body.message.call not found or invalid. Checking top-level body.call.');
      if (body && body.call && typeof body.call === 'object' && body.call !== null) {
        const topLevelCallObject = body.call;
        console.log(`INFO: Found top-level body.call. Keys: ${Object.keys(topLevelCallObject).join(', ')}`);
        if (topLevelCallObject.id && typeof topLevelCallObject.id === 'string' && topLevelCallObject.id.trim() !== '') {
            actualVapiCallId = topLevelCallObject.id;
            console.log(`SUCCESS (Fallback): Extracted actualVapiCallId from top-level body.call.id: '${actualVapiCallId}'`);
        }
         if (topLevelCallObject.customer && typeof topLevelCallObject.customer === 'object' && topLevelCallObject.customer !== null &&
            topLevelCallObject.customer.number && typeof topLevelCallObject.customer.number === 'string' && topLevelCallObject.customer.number.trim() !== '') {
            actualUserPhoneNumber = topLevelCallObject.customer.number;
            console.log(`SUCCESS (Fallback): Extracted actualUserPhoneNumber from top-level body.call.customer.number: '${actualUserPhoneNumber}'`);
        } else if (!actualUserPhoneNumber) { actualUserPhoneNumber = null; }
      } else { console.warn('WARNING: Top-level body.call also not found or invalid.'); }
    }
    if (!actualUserPhoneNumber) actualUserPhoneNumber = null;
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
    departmentName: departmentName,
    vapiCallId: actualVapiCallId,
    userPhoneNumber: actualUserPhoneNumber || 'N/A',
    timestamp: new Date().toISOString(),
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

// --- Twilio Endpoint for Specialist Call Status Updates ---
app.post('/twilio/voice/specialist-status', async (req, res) => {
  const userCallSid = req.query.userCallSid; // CallSid of the original user still in conference
  const conferenceName = req.query.confName;
  const specialistIndex = parseInt(req.query.specialistIndex, 10);
  const specialistCallSid = req.body.CallSid; // CallSid of the specialist's call leg
  const callStatus = req.body.CallStatus; // e.g., "completed", "busy", "failed", "no-answer"
  const answeredBy = req.body.AnsweredBy; // For AMD, if enabled

  console.log(`--- /twilio/voice/specialist-status for userCallSid: ${userCallSid}, specialistIndex: ${specialistIndex} ---`);
  console.log(`Specialist CallSid: ${specialistCallSid}, Status: ${callStatus}, AnsweredBy: ${answeredBy}`);
  console.log('Twilio Status Callback Body:', JSON.stringify(req.body, null, 2));

  const transferSession = activeSequentialTransfers[userCallSid];

  if (!transferSession) {
    console.error(`CRITICAL: No active transfer session found for userCallSid: ${userCallSid}. Cannot process specialist status.`);
    return res.status(200).send(); // Acknowledge Twilio, but can't do much
  }

  // Check if this specialist was the one we expected for this index
  if (transferSession.specialistList[specialistIndex] !== req.body.To) {
      console.warn(`WARNING: Specialist status callback for unexpected number. Expected ${transferSession.specialistList[specialistIndex]}, got ${req.body.To} for index ${specialistIndex}`);
      // Decide if to proceed or ignore. For now, we'll proceed if index matches.
  }
  
  // --- Handle Call Status ---
  // We consider a call successful if 'completed' and NOT by an answering machine (basic check)
  // A more robust AMD check might be needed if `AnsweredBy` is consistently `human`.
  const successfulConnection = callStatus === 'completed' && (!answeredBy || (answeredBy && !answeredBy.startsWith('machine') && answeredBy !== 'fax' && answeredBy !== 'unknown'));
  // Also, Twilio's 'answered' status for statusCallbackEvent means the call was picked up.
  // 'completed' means the call has finished. We need to check if it was answered *during* its lifetime.
  // The 'DialCallStatus' from a <Dial><Conference> status callback is different from this outbound call status.
  // For an outbound call, 'completed' with a duration > 0 usually means it was answered.
  // If 'AnsweredBy' is available and not 'human', we treat as failure.

  if (successfulConnection) {
    console.log(`SUCCESS: Specialist ${transferSession.specialistList[specialistIndex]} (index ${specialistIndex}) answered and joined conference ${conferenceName}.`);
    activeSequentialTransfers[userCallSid].status = `specialist_${specialistIndex}_joined`;
    // No need to dial next specialist. User and specialist are in conference.
  } else {
    console.log(`INFO: Specialist ${transferSession.specialistList[specialistIndex]} (index ${specialistIndex}) did not connect successfully. Status: ${callStatus}, AnsweredBy: ${answeredBy}.`);
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
              to: transferSession.specialistList[nextSpecialistIndex],
              from: twilioPhoneNumber,
              url: nextSpecialistJoinUrl,
              method: 'POST',
              statusCallback: nextSpecialistStatusCallbackUrl,
              statusCallbackMethod: 'POST',
              statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed']
            });
            console.log(`Successfully initiated call to next specialist: ${transferSession.specialistList[nextSpecialistIndex]}`);
        }
      } catch (error) {
        console.error(`Error calling next specialist ${transferSession.specialistList[nextSpecialistIndex]}:`, error.message);
        // If this fails, we might want a more robust retry or immediate fallback to voicemail.
        // For now, we'll let it be, and if all fail, the user is still on hold.
      }
    } else {
      console.log(`INFO: All specialists tried for department ${transferSession.departmentName} for userCallSid ${userCallSid}. No one answered.`);
      activeSequentialTransfers[userCallSid].status = 'all_specialists_failed';
      // TODO: Implement voicemail fallback here.
      // This would involve taking the user out of the conference and redirecting their call leg
      // to a TwiML endpoint that plays a voicemail prompt and records.
      // Or, redirect to VAPI to handle voicemail.
      console.log("VOICEMAIL FALLBACK TO BE IMPLEMENTED HERE.");
      // For now, user remains in conference on hold music.
      // We could also update the user's call leg with a message:
      // try {
      //   const twimlUserFail = new twilio.twiml.VoiceResponse();
      //   twimlUserFail.say("Sorry, all specialists are currently unavailable. Please try again later.");
      //   twimlUserFail.hangup();
      //   await twilioClient.calls(userCallSid).update({ twiml: twimlUserFail.toString() });
      //   console.log(`Played 'all unavailable' message to user ${userCallSid} and hung up.`);
      // } catch (err) {
      //   console.error(`Error updating user call ${userCallSid} for voicemail fallback:`, err.message);
      // }
      // delete activeSequentialTransfers[userCallSid]; // Clean up session
    }
  }
  console.log('Updated Active Sequential Transfers State:', JSON.stringify(activeSequentialTransfers[userCallSid], null, 2));
  res.status(200).send(); // Always respond 200 OK to Twilio status callbacks
});


app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
  console.log('Press Ctrl+C to stop the server.');
  if (process.env.YOUR_RENDER_APP_BASE_URL && process.env.YOUR_RENDER_APP_BASE_URL !== `http://localhost:${PORT}`) {
    console.log(`Once deployed, it should be accessible at ${process.env.YOUR_RENDER_APP_BASE_URL}`);
  }
});

module.exports = app;
