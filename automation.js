// Required Modules
const https = require('https');
const querystring = require('querystring');
const cheerio = require('cheerio');
const { performance } = require('perf_hooks');
const notifier = require('node-notifier');

// Custom HTTPS Agent Configuration
const httpsAgent = new https.Agent({
  rejectUnauthorized: false, // Disable SSL certificate verification
  keepAlive: true,           // Enable keep-alive for persistent connections
  maxSockets: 50,            // Maximum number of sockets per host
  maxFreeSockets: 10,        // Maximum number of free sockets per host
});

// Function to Extract and Merge Cookies from Response Headers
function extractAndMergeCookies(headers, currentCookies) {
  const setCookies = headers['set-cookie'];
  if (setCookies) {
    const newCookies = setCookies.map(cookie => cookie.split(';')[0]);
    const cookieMap = new Map(
      (currentCookies || '')
        .split('; ')
        .filter(Boolean)
        .map(cookie => cookie.split('='))
    );
    newCookies.forEach(cookie => {
      const [key, value] = cookie.split('=');
      cookieMap.set(key, value);
    });
    return Array.from(cookieMap.entries()).map(([key, value]) => `${key}=${value}`).join('; ');
  }
  return currentCookies || '';
}

// Function to Perform Login Automation
async function automateLogin({r,p}, ipAddress) {
  const got = (await import('got')).default;

  try {
    let cookies = "";

    // Step 1: GET `/` to retrieve initial cookies (e.g., `connect.sid`)
    let response = await got(`https://${ipAddress}/`, {
      method: 'GET',
      headers: getCommonHeaders(),
      responseType: 'text',
      agent: { https: httpsAgent },
      followRedirect: false,
      throwHttpErrors: false,
    });

    // Merge cookies from the initial response
    cookies = extractAndMergeCookies(response.headers, cookies);
    console.log('Step 1: Retrieved initial cookies:', cookies);

    // Step 2: POST `/student/login` with credentials to retrieve `token`
    const credentials = querystring.stringify({
      roll_no: r,
      password: p,
    });

    response = await got(`https://${ipAddress}/student/login`, {
      method: 'POST',
      body: credentials,
      headers: {
        "Host" : "reg.exam.dtu.ac.in",
        "Cache-Control": "max-age=0",
        "Sec-Ch-Ua": '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
        "Sec-Ch-Ua-Mobile": "?0",
        "Sec-Ch-Ua-Platform": '"Windows"',
        "Accept-Language": "en-GB,en-US;q=0.9,en;q=0.8",
        "Origin": "https://reg.exam.dtu.ac.in",
        "Content-Type": "application/x-www-form-urlencoded",
        "Upgrade-Insecure-Requests": "1",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-User": "?1",
        "Sec-Fetch-Dest": "document",
        "Referer" : "https://reg.exam.dtu.ac.in/student/login", 
        "Accept-Encoding": "gzip, deflate, br, zstd",
        "Priority": "u=0, i",
        "Connection": "keep-alive",
        'Cookie': cookies,
        "DNT" : "1",
      },
      responseType: 'text',
      agent: {https: httpsAgent},
      followRedirect: false,
      throwHttpErrors: false,
    });

    cookies = extractAndMergeCookies(response.headers, cookies);
    console.log('Step 2: Retrieved token and updated cookies:', cookies);

    const match = response.body.match(/\/student\/home\/([a-zA-Z0-9]+)/);
    let studentHash = "";
    if (match && match[1]) {
      studentHash = match[1];
      console.log('Extracted Student Hash:', studentHash);
    } else {
      if (response.body.includes('Invalid Roll No or Password')) {
          throw new Error('Invalid Roll Number or Password.');
      }
      throw new Error('Could not extract student hash from the login response.');
    }

    return { cookies, studentHash };
  } catch (error) {
    console.error('Error during login:', error.message);
    throw error;
  }
}

// Function to Fetch Course Registration HTML Content
async function fetchCourseRegHTML(cookies, studentHash, ipAddress) {
  const { default: got } = await import('got');

  try {
    const response = await got(`https://${ipAddress}/student/courseRegistration/${studentHash}`, {
      method: 'GET',
      headers: {
        ...getCommonHeaders(),
        'Referer': `https://reg.exam.dtu.ac.in/student/home/${studentHash}`,
        'Cookie': cookies,
      },
      agent: { https: httpsAgent },
      responseType: 'text',
      followRedirect: false,
    });

    if (response.statusCode !== 200) {
      throw new Error(`Failed to fetch course registration page. Status code: ${response.statusCode}`);
    }

    console.log('Fetched course registration page successfully.');
    // console.log(response.body);
    return response.body;
  } catch (error) {
    console.warn("Warning: Unable to fetch course registration HTML content.", error);
    return null;
  }
}

// Function to Fetch and Track Desired Courses
async function fetchTrackedCourses(cookies, studentHash, ipAddress, courseCodes) {
  const htmlContent = await fetchCourseRegHTML(cookies, studentHash, ipAddress);

  if (!htmlContent) {
    throw new Error("No HTML content fetched for course registration.");
  }

  try {
    const $ = cheerio.load(htmlContent);
    const trackedCourses = new Map();

    const parsedCourses = new Map(
      courseCodes.map(code => {
        const [courseCode, courseSlot] = code.split(":");
        return [courseCode, courseSlot];
      })
    );

    $("div.elective-subjects.table-responsive table.table-hover.table-bordered tbody tr:not(.setHeader)").each((_, row) => {
      const cells = $(row).find("td");
      if (cells.length === 6) {
        const courseCode = $(cells[1]).text().trim();
        // console.log(`Processing Course: ${courseCode}`);
        const courseSlot = $(cells[3]).text().trim();
        // console.log(`Course Slot: ${courseSlot}`);
        const seats = parseInt($(cells[4]).text().trim(), 10) || 0;
        // console.log(`Available Seats: ${seats}`);
        const formAction = $(cells[5]).find("form").attr("action");
        // console.log(`Form Action: ${formAction}`);
        if (formAction) {
          const courseHashMatch = formAction.match(new RegExp(`/student/courseRegister/${studentHash}/([a-zA-Z0-9]+)`));
          const courseHash = courseHashMatch ? courseHashMatch[1] : null;

          if (courseHash && parsedCourses.has(courseCode) && parsedCourses.get(courseCode) === courseSlot) {
            trackedCourses.set(courseHash, {
              courseCode,
              courseSlot,
              seats,
            });
            parsedCourses.delete(courseCode); // Remove found 
            console.log(`Tracking Course: ${courseCode} (Slot: ${courseSlot}) with Hash: ${courseHash} and Seats: ${seats}`);
          }
        }
      }
    });

    // Check for courses that were not found
    // console.log(parsedCourses);
    if (parsedCourses.size > 0) {
      const notFound = Array.from(parsedCourses.keys()).join(', ');
      throw new Error(`The following course(s) were not found: ${notFound}. Please check the course code and slot.`);
    }
    // console.log(`Total Courses Being Tracked: ${trackedCourses}`);
    return trackedCourses;
  } catch (error) {
    console.error("Error processing courses:", error);
    return new Map();
  }
}

// Function to Send POST Request for Course Registration
const sendPostReq = async (cookies, studentHash, ipAddress, courseHash) => {
  const { default: got } = await import('got');

  try {
    const response = await got.post(`https://${ipAddress}/student/courseRegister/${studentHash}/${courseHash}`, {
      headers: {
        ...getCommonHeaders(),
        'Referer': `https://reg.exam.dtu.ac.in/student/courseRegistration/${studentHash}`,
        'Cookie': cookies,
        'Content-Length': '0',
      },
      responseType: "text",
      agent: { https: httpsAgent },
      throwHttpErrors: false,
      followRedirect: false,
    });

    console.log(`POST Request to register course ${courseHash} - Status Code: ${response.statusCode}`);
  } catch (error) {
    console.error("Error sending POST request:", error.message);
  }
};

let isRunning = false;

// Handler Logic to Monitor and Register Courses
const handlerLogic = async (cookies, studentHash, ipAddress, trackedCourses, callbacks) => {
  const { default: got } = await import('got');
  let previousEtag = null;

  const sendGetReq = async () => {
    if (!isRunning) return null;
    try {
      const response = await got(`https://${ipAddress}/student/courseRegistration/${studentHash}`, {
        method: 'GET',
        headers: {
          ...getCommonHeaders(),
          'Referer': `https://reg.exam.dtu.ac.in/student/home/${studentHash}`,
          'Cookie': cookies,
        },
        agent: { https: httpsAgent },
        responseType: 'text',
        followRedirect: false,
      });

      const currentEtag = response.headers['etag'];
      if (previousEtag && currentEtag === previousEtag) {
        callbacks.onStatusUpdate('No updates found (ETag unchanged).');
        return null;
      }
      callbacks.onStatusUpdate('New data fetched (ETag changed).');
      previousEtag = currentEtag;

      const $ = cheerio.load(response.body);

      if (response.body.length < 18000 && $('p').text().includes('Found. Redirecting to /student/login')) {
        throw new Error("Session Expired. Please log in again.");
      }

      const alertDiv = $('div.alert.alert-danger.alert-dismissible.fade.show[role="alert"]');
      if (alertDiv.length > 0) {
        callbacks.onStatusUpdate(`Alert: ${alertDiv.text().trim()}`);
      }

      $("tr[bgcolor='#0ff288']").each((_, element) => {
        const courseHashMatch = $(element).find("form[action*='/student/courseRegister/']").attr("action")?.match(/\/([a-f0-9]{24})$/);
        if (courseHashMatch) {
          const courseHash = courseHashMatch[1];
          if (trackedCourses.has(courseHash)) {
            const removedCourse = trackedCourses.get(courseHash);
            trackedCourses.delete(courseHash);
            callbacks.onCourseRegistered(removedCourse);
            callbacks.onStatusUpdate(`Course Already Registered: ${removedCourse.courseCode} - Dropping from tracking.`);
          }
        }
      });

      return $;
    } catch (error) {
      callbacks.onError(error.message);
      throw error;
    }
  };

  const checkAndRegister = async () => {
    while (isRunning) {
      const $ = await sendGetReq();
      if (!$) {
        await delay(1000);
        continue;
      }

      const slotsToTrack = groupCoursesBySlot(trackedCourses);
      let registeredSomething = false;

      for (const [courseSlot, courses] of slotsToTrack.entries()) {
        if (!isRunning) return;
        const slotHeader = $(`tr.setHeader td[colspan="3"]:contains(${courseSlot})`);
        if (slotHeader.length === 0) continue;

        const slotRows = gatherSlotRows(slotHeader);

        for (const row of slotRows) {
          if (!isRunning) return;
          const cells = $(row).find("td");
          const courseCode = $(cells[1]).text().trim();
          const courseData = courses.find(c => c.courseCode === courseCode);

          if (courseData) {
            const { courseHash, seats: trackedSeats } = courseData;
            const newSeats = parseInt($(cells[4]).text().trim(), 10) || 0;

            if (newSeats !== trackedSeats) {
              const updatedCourseData = { ...courseData, seats: newSeats };
              trackedCourses.set(courseHash, updatedCourseData);
              callbacks.onStatusUpdate(`Seat Update: ${courseCode} (${courseData.courseSlot}) - Seats: ${trackedSeats} -> ${newSeats}`);
            }

            if (newSeats > 0) {
              await sendPostReq(cookies, studentHash, ipAddress, courseHash);
              callbacks.onStatusUpdate(`Attempting to register for ${courseCode}...`);
              registeredSomething = true;
              break;
            }
          }
        }
        if (registeredSomething) break;
      }

      if (registeredSomething) {
        await delay(1000);
        continue;
      }

      if (trackedCourses.size === 0) {
        callbacks.onStatusUpdate('All courses have been registered. Stopping automation.');
        break;
      }

      await delay(1000);
    }
  };

  await checkAndRegister();
};

// Utility Function to Get Common Headers
function getCommonHeaders() {
  return {
    "Host": "reg.exam.dtu.ac.in",
    "Sec-Ch-Ua": '"Google Chrome";v="131", "Chromium";v="131", "Not_  A Brand";v="24"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"Windows"',
    "Accept-Language": "en-GB,en-US;q=0.9,en;q=0.8",
    "Upgrade-Insecure-Requests": "1",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-User": "?1",
    "Sec-Fetch-Dest": "document",
    "Accept-Encoding": "gzip, deflate, br, zstd",
    "Priority": "u=0, i",
    "Connection": "keep-alive",
    "DNT": "1",
  };
}

// Utility Function to Delay Execution
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Utility Function to Group Courses by Slot
function groupCoursesBySlot(trackedCourses) {
  const slotsToTrack = new Map();
  for (const [courseHash, { courseCode, courseSlot, seats }] of trackedCourses.entries()) {
    if (!slotsToTrack.has(courseSlot)) {
      slotsToTrack.set(courseSlot, []);
    }
    slotsToTrack.get(courseSlot).push({ courseHash, courseCode, seats });
  }
  return slotsToTrack;
}

// Utility Function to Gather Rows Under a Slot Header
function gatherSlotRows(slotHeader) {
  const slotRows = [];
  let currentRow = slotHeader.parent().next();
  while (currentRow.length > 0) {
    if (currentRow.hasClass("setHeader")) break;
    slotRows.push(currentRow[0]);
    currentRow = currentRow.next();
  }
  return slotRows;
}

// Main Execution Function
async function startAutomation(credentials, ipAddress, courseIdsToTrack, callbacks) {
  isRunning = true;
  try {
    callbacks.onStatusUpdate('Attempting to log in...');
    const { cookies, studentHash } = await automateLogin(credentials, ipAddress);

    callbacks.onStatusUpdate('Login successful. Fetching courses...');
    const trackedCourses = await fetchTrackedCourses(cookies, studentHash, ipAddress, courseIdsToTrack);

    if (trackedCourses.size === 0) {
      throw new Error("No courses to track. They may already be registered or the list is empty.");
    }
    
    if (!isRunning) return;

    callbacks.onStatusUpdate(`Now tracking ${trackedCourses.size} course(s). Monitoring for seat availability...`);
    await handlerLogic(cookies, studentHash, ipAddress, trackedCourses, callbacks);
  } catch (error) {
    callbacks.onError(error.message);
  } finally {
    if (isRunning) {
      isRunning = false;
      if (callbacks && callbacks.onStop) {
        callbacks.onStop();
      }
    }
  }
}

function stopAutomation() {
  if (isRunning) {
    isRunning = false;
  }
}

module.exports = { startAutomation, stopAutomation };
