const SHEET_ID = "1sbKGknuz6xB1xdohKec4dvnb6Ifvnb6BeDdeklocMgo";
const ADMIN_EMAIL = "amanfaizal04@gmail.com";

const WHATSAPP_NUMBER = "917356188530";
const WHATSAPP_APIKEY = "YOUR_API_KEY";

const SESSION_EXPIRY_HOURS = 8;

/* ================================
   ROUTER
================================ */

function doPost(e) {
  const action = e.parameter.action;

  if (action === "login") return login(e);
  if (action === "createTicket") return createTicket(e);
  if (action === "updateTicket") return updateTicket(e);
  if (action === "getTickets") return getTickets(e);
  if (action === "getAnalytics") return getAnalytics(e);

  return ContentService.createTextOutput("Invalid action");
}

function doGet() {
  return ContentService.createTextOutput("IT Ticket System Running");
}

/* ================================
   LOGIN
================================ */

function login(e) {
  const email = e.parameter.email;
  const password = e.parameter.password;

  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName("Users");
  const data = sheet.getDataRange().getValues();

  const hash = hashPassword(password);

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === email && data[i][1] === hash) {
      const token = Utilities.getUuid();
      const expiry = new Date(new Date().getTime() + SESSION_EXPIRY_HOURS * 3600000);

      CacheService.getScriptCache().put(token, JSON.stringify({
        email: email,
        role: data[i][2],
        expiry: expiry
      }), SESSION_EXPIRY_HOURS * 3600);

      return ContentService
        .createTextOutput(JSON.stringify({ token, role: data[i][2] }))
        .setMimeType(ContentService.MimeType.JSON);
    }
  }

  return ContentService.createTextOutput("Invalid credentials");
}

/* ================================
   CREATE TICKET
================================ */

function createTicket(e) {
  const user = validateToken(e.parameter.token);
  if (!user) return ContentService.createTextOutput("Unauthorized");

  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName("Tickets");

  const ticketId = generateTicketId(sheet);

  const priority = e.parameter.priority;

  const slaHours =
    priority === "High" ? 4 :
    priority === "Medium" ? 12 : 24;

  const dueTime = new Date(new Date().getTime() + slaHours * 3600000);

  sheet.appendRow([
    ticketId,
    new Date(),
    user.email,
    user.email,
    e.parameter.title,
    e.parameter.description,
    priority,
    "Open",
    "Unassigned",
    new Date(),
    slaHours,
    dueTime
  ]);

  MailApp.sendEmail(
    ADMIN_EMAIL,
    "New Ticket: " + ticketId,
    "Priority: " + priority + "\n\n" + e.parameter.description
  );

  sendWhatsApp("New Ticket: " + ticketId + " | Priority: " + priority);

  return ContentService.createTextOutput("Ticket Created: " + ticketId);
}

/* ================================
   UPDATE TICKET
================================ */

function updateTicket(e) {
  const user = validateToken(e.parameter.token);
  if (!user) return ContentService.createTextOutput("Unauthorized");

  if (user.role !== "Admin" && user.role !== "Technician")
    return ContentService.createTextOutput("Forbidden");

  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName("Tickets");
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === e.parameter.ticketId) {

      sheet.getRange(i + 1, 8).setValue(e.parameter.status);
      sheet.getRange(i + 1, 9).setValue(e.parameter.assignedTo);
      sheet.getRange(i + 1, 10).setValue(new Date());

      return ContentService.createTextOutput("Updated");
    }
  }

  return ContentService.createTextOutput("Ticket Not Found");
}

/* ================================
   GET TICKETS
================================ */

function getTickets(e) {
  const user = validateToken(e.parameter.token);
  if (!user) return ContentService.createTextOutput("Unauthorized");

  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName("Tickets");
  const data = sheet.getDataRange().getValues();

  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ================================
   ANALYTICS
================================ */

function getAnalytics(e) {
  const user = validateToken(e.parameter.token);
  if (!user) return ContentService.createTextOutput("Unauthorized");

  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName("Tickets");
  const data = sheet.getDataRange().getValues();

  let total = data.length - 1;
  let open = 0;
  let closed = 0;
  let overdue = 0;

  for (let i = 1; i < data.length; i++) {
    if (data[i][7] === "Open") open++;
    if (data[i][7] === "Closed") closed++;
    if (data[i][7] === "Open" && new Date() > new Date(data[i][11])) overdue++;
  }

  return ContentService
    .createTextOutput(JSON.stringify({
      total,
      open,
      closed,
      overdue
    }))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ================================
   AUTO CLOSE AFTER 48H
================================ */

function autoCloseTickets() {
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName("Tickets");
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][7] === "Resolved") {
      const diff = (new Date() - new Date(data[i][9])) / 3600000;
      if (diff >= 48) {
        sheet.getRange(i + 1, 8).setValue("Closed");
      }
    }
  }
}

/* ================================
   SLA BREACH ALERT
================================ */

function checkSLABreach() {
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName("Tickets");
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][7] === "Open" && new Date() > new Date(data[i][11])) {
      sendWhatsApp("SLA Breach: " + data[i][0]);
    }
  }
}

/* ================================
   HELPERS
================================ */

function validateToken(token) {
  const cache = CacheService.getScriptCache();
  const session = cache.get(token);
  if (!session) return null;

  const parsed = JSON.parse(session);

  if (new Date() > new Date(parsed.expiry)) return null;

  return parsed;
}

function generateTicketId(sheet) {
  const year = new Date().getFullYear();
  const count = sheet.getLastRow();
  return "TCK-" + year + "-" + ("0000" + count).slice(-4);
}

function hashPassword(password) {
  const raw = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    password
  );
  return raw.map(b => (b < 0 ? b + 256 : b).toString(16).padStart(2, '0')).join('');
}

function sendWhatsApp(message) {
  if (!WHATSAPP_APIKEY || WHATSAPP_APIKEY === "YOUR_API_KEY") return;

  const url = "https://api.callmebot.com/whatsapp.php?phone=" +
    WHATSAPP_NUMBER +
    "&text=" + encodeURIComponent(message) +
    "&apikey=" + WHATSAPP_APIKEY;

  UrlFetchApp.fetch(url);
}


function createAdminUser() {
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName("Users");
  const password = "Admin@123456";
  const hash = hashPassword(password);
  sheet.appendRow(["admin@aman5z.in", hash, "Admin"]);
}

function createNormalUser() {
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName("Users");
  const password = "123456";
  const hash = hashPassword(password);
  sheet.appendRow(["testuser", hash, "User"]);
}

function createTechnicianUser() {
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName("Users");
  const password = "06112024";
  const hash = hashPassword(password);
  sheet.appendRow(["aman", hash, "Technician"]);
}