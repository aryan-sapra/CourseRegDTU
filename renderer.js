// renderer.js

document.addEventListener('DOMContentLoaded', () => {
  const addCourseBtn = document.getElementById('add-course');
  const courseList = document.getElementById('course-list');
  const startBtn = document.getElementById('start-btn');
  const stopBtn = document.getElementById('stop-btn');
  const statusArea = document.getElementById('status-area');
  const errorArea = document.getElementById('error-area');
  const registeredList = document.getElementById('registered-list');
  const togglePassword = document.getElementById('toggle-password');
  const passwordInput = document.getElementById('password');

  let isAutomationRunning = false;

  // Toggle password visibility
  togglePassword.addEventListener('click', () => {
    const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
    passwordInput.setAttribute('type', type);
    togglePassword.classList.toggle('fa-eye-slash');
  });

  // Function to display errors
  function showError(message) {
    errorArea.textContent = message;
    errorArea.classList.remove('hidden');
  }

  // Function to clear errors
  function clearError() {
    errorArea.classList.add('hidden');
  }

  // Function to update UI state
  function setUIState(isAutomationRunning) {
    startBtn.classList.toggle('hidden', isAutomationRunning);
    stopBtn.classList.toggle('hidden', !isAutomationRunning);
    addCourseBtn.disabled = isAutomationRunning;

    document.getElementById('roll-no').disabled = isAutomationRunning;
    document.getElementById('password').disabled = isAutomationRunning;

    const courseRows = document.querySelectorAll('.course-row input, .course-row button');
    courseRows.forEach(element => {
      element.disabled = isAutomationRunning;
    });
  }

  // Add a new course input row
  addCourseBtn.addEventListener('click', () => {
    const row = document.createElement('div');
    row.className = 'course-row';

    const courseCodeInput = document.createElement('input');
    courseCodeInput.type = 'text';
    courseCodeInput.placeholder = 'Course Code';
    courseCodeInput.required = true;

    const courseSlotInput = document.createElement('input');
    courseSlotInput.type = 'text';
    courseSlotInput.placeholder = 'Slot';
    courseSlotInput.required = true;

    const removeBtn = document.createElement('button');
    removeBtn.textContent = 'Remove';
    removeBtn.className = 'remove-course';

    removeBtn.addEventListener('click', () => {
      courseList.removeChild(row);
    });

    row.appendChild(courseCodeInput);
    row.appendChild(courseSlotInput);
    row.appendChild(removeBtn);

    courseList.appendChild(row);
  });

  // Start the automation process
  startBtn.addEventListener('click', async () => {
    clearError();
    const rollNo = document.getElementById('roll-no').value.trim();
    const password = document.getElementById('password').value.trim();

    if (!rollNo || !password) {
      showError('Please enter both Roll Number and Password.');
      return;
    }

    const courseRows = document.querySelectorAll('.course-row');
    const courses = [];
    courseRows.forEach(row => {
      const inputs = row.querySelectorAll('input');
      const courseCode = inputs[0].value.trim();
      const courseSlot = inputs[1].value.trim();
      if (courseCode && courseSlot) {
        courses.push(`${courseCode}:${courseSlot}`);
      }
    });

    if (courses.length === 0) {
      showError('Please add at least one course to track.');
      return;
    }

    isAutomationRunning = true;
    setUIState(isAutomationRunning);
    statusArea.textContent = 'Starting automation...';

    const response = await window.electronAPI.startAutomation({
      creds: { r: rollNo, p: password },
      courses: courses,
    });

    if (!response.success) {
      showError(response.error);
      isAutomationRunning = false;
      setUIState(isAutomationRunning);
      statusArea.textContent = 'Automation failed to start.';
    } else {
      statusArea.textContent = 'Automation is running. Monitoring courses...';
    }
  });

  // Stop the automation process
  stopBtn.addEventListener('click', async () => {
    await window.electronAPI.stopAutomation();
    isAutomationRunning = false;
    setUIState(isAutomationRunning);
    statusArea.textContent = 'Automation stopped by user.';
  });

  // Listen for status updates
  window.electronAPI.onStatusUpdate((event, message) => {
    statusArea.textContent = message;
  });

  // Listen for course registration updates
  window.electronAPI.onCourseRegistered((event, course) => {
    const li = document.createElement('li');
    const timestamp = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    li.innerHTML = `${course.courseCode} (Slot: ${course.courseSlot}) - Registered! <span class="timestamp">${timestamp}</span>`;
    registeredList.appendChild(li);
  });

  // Listen for error messages
  window.electronAPI.onError((event, errorMessage) => {
    showError(errorMessage);
    isAutomationRunning = false;
    setUIState(isAutomationRunning);
    statusArea.textContent = 'An error occurred.';
  });
});