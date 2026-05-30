const TelegramBot = require("node-telegram-bot-api");

const TOKEN = "8951491096:AAEeBihTnvxfRH1pbC47tvGd__FhqcfAcq4";
const ADMIN_ID = 6222544109; // Admin Telegram ID
const ADMIN_CODE = "salom"; // Admin paneliga kirish kodi

// ═══════════════════════════════════════════════════════════════
// KARTA MA'LUMOTLARI
// ═══════════════════════════════════════════════════════════════
const CARD_NUMBER = "8600 0609 9498 4103";
const CARD_HOLDER = "Samoyka"; // Karta egasi

const bot = new TelegramBot(TOKEN, { polling: true });

// ═══════════════════════════════════════════════════════════════
// SOZLAMALAR
// ═══════════════════════════════════════════════════════════════
const LANES = [
  { id: 1, name: "1-kalanoka", type: "yengil", washMin: 30 },
  { id: 2, name: "2-kalanoka", type: "yengil", washMin: 30 },
  { id: 3, name: "3-kalanoka", type: "yuk",    washMin: 60 },
];

const YENGIL_CARS = [
  "Chevrolet Cobalt",  "Chevrolet Nexia",
  "Chevrolet Malibu",  "Chevrolet Tracker",
  "Chevrolet Equinox", "Toyota Camry",
  "Toyota Corolla",    "Hyundai Tucson",
  "Kia Rio",           "BMW 5 Series",
  "Mercedes E-Class",  "Damas / Labo",
  "Boshqa yengil",
];

const YUK_CARS = [
  "Gazelle",        "GAZelle Next",
  "MAN TGX",        "Volvo FH",
  "Mercedes Actros","DAF XF",
  "Kamaz",          "Isuzu Truck",
  "Hyundai HD",     "Scania R-Series",
  "Boshqa yuk",
];

const COLORS = [
  "⚪ Oq",      "⚫ Qora",
  "🔘 Kumush",  "🔴 Qizil",
  "🔵 Ko'k",   "🟢 Yashil",
  "🟡 Sariq",   "🟤 Jigarrang",
  "🟠 To'q sariq", "⬜ Kulrang",
];

// Ish vaqti sozlamalari
const WORK_START = 8;   // 08:00
const WORK_END   = 23;  // 23:00
const SLOTS_PER_PAGE = 6;

// ═══════════════════════════════════════════════════════════════
// MA'LUMOTLAR
// ═══════════════════════════════════════════════════════════════
let laneQueues = { 1: [], 2: [], 3: [] };
let counter    = 1;
let userState  = {};
let adminSessions = {};

// ═══════════════════════════════════════════════════════════════
// YORDAMCHI FUNKSIYALAR
// ═══════════════════════════════════════════════════════════════
function addMinutes(date, min) {
  return new Date(date.getTime() + min * 60000);
}

function fmt(date) {
  return date.toLocaleTimeString("uz-UZ", { hour: "2-digit", minute: "2-digit" });
}

function fmtTime(hours, minutes) {
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function isAdmin(chatId) {
  const session = adminSessions[chatId];
  if (!session) return false;
  if (Date.now() > session.expiresAt) {
    delete adminSessions[chatId];
    return false;
  }
  return true;
}

function generateTimeSlots(carType) {
  const slotDuration = carType === "yengil" ? 30 : 60;
  const slots = [];
  let currentMinutes = WORK_START * 60;
  const endMinutes = WORK_END * 60;

  while (currentMinutes + slotDuration <= endMinutes) {
    const startH = Math.floor(currentMinutes / 60);
    const startM = currentMinutes % 60;
    const endTotal = currentMinutes + slotDuration;
    const endH = Math.floor(endTotal / 60);
    const endM = endTotal % 60;

    slots.push({
      startMin: currentMinutes,
      endMin: endTotal,
      label: `${fmtTime(startH, startM)} - ${fmtTime(endH, endM)}`,
    });

    currentMinutes += slotDuration;
  }
  return slots;
}

function isLaneAvailableDuring(laneId, slotStartMin, slotEndMin) {
  const active = laneQueues[laneId].filter(e => e.status === "pending" || e.status === "confirmed");
  for (const entry of active) {
    const eStart = entry.startTime.getHours() * 60 + entry.startTime.getMinutes();
    const eEnd   = entry.endTime.getHours() * 60 + entry.endTime.getMinutes();
    if (slotStartMin < eEnd && eStart < slotEndMin) {
      return false;
    }
  }
  return true;
}

function isSlotAvailableForType(carType, slotStartMin, slotEndMin) {
  const lanes = LANES.filter(l => l.type === carType);
  return lanes.some(l => isLaneAvailableDuring(l.id, slotStartMin, slotEndMin));
}

function getAvailableLaneForSlot(carType, slotStartMin, slotEndMin) {
  const lanes = LANES.filter(l => l.type === carType);
  for (const lane of lanes) {
    if (isLaneAvailableDuring(lane.id, slotStartMin, slotEndMin)) {
      return lane;
    }
  }
  return null;
}

function getTimeSlotKeyboard(carType, page = 0) {
  const slots = generateTimeSlots(carType);
  const now = new Date();
  const currentMin = now.getHours() * 60 + now.getMinutes();

  const futureSlots = slots.filter(s => s.startMin > currentMin);

  if (futureSlots.length === 0) {
    return {
      text: "😔 Bugun bo'sh vaqt qolmadi. Iltimos ertaga qayta urinib ko'ring.",
      keyboard: [[{ text: "❌ Bekor qilish", callback_data: "cancel" }]],
      totalPages: 0,
    };
  }

  const totalPages = Math.ceil(futureSlots.length / SLOTS_PER_PAGE);
  const currentPage = Math.max(0, Math.min(page, totalPages - 1));

  const pageSlots = futureSlots.slice(
    currentPage * SLOTS_PER_PAGE,
    (currentPage + 1) * SLOTS_PER_PAGE
  );

  const rows = [];
  for (const slot of pageSlots) {
    const available = isSlotAvailableForType(carType, slot.startMin, slot.endMin);
    const prefix = available ? "time|||" : "time_busy|||";
    const icon = available ? "✅" : "❌";
    const status = available ? "bo'sh" : "band";
    rows.push([{
      text: `${icon} ${slot.label} (${status})`,
      callback_data: `${prefix}${slot.startMin}-${slot.endMin}`,
    }]);
  }

  const navRow = [];
  if (currentPage > 0) {
    navRow.push({ text: "⬅️ Oldingi", callback_data: `timepage|||${currentPage - 1}` });
  }
  navRow.push({ text: `${currentPage + 1}/${totalPages}`, callback_data: "timepage_info" });
  if (currentPage < totalPages - 1) {
    navRow.push({ text: "Keyingi ➡️", callback_data: `timepage|||${currentPage + 1}` });
  }
  if (navRow.length) rows.push(navRow);

  rows.push([{ text: "❌ Bekor qilish", callback_data: "cancel" }]);

  const emoji = carType === "yengil" ? "🚗" : "🚛";
  const duration = carType === "yengil" ? "30 daqiqa" : "1 soat";
  const text =
    `🕐 *Vaqt tanlang:*\n\n` +
    `${emoji} Mashina turi: *${carType === "yengil" ? "Yengil" : "Yuk"}*\n` +
    `⏱ Yuvish vaqti: *${duration}*\n` +
    `🕐 Ish vaqti: *08:00 - 23:00*\n\n` +
    `✅ — bo'sh vaqt\n❌ — band vaqt\n\n` +
    `Sahifa: ${currentPage + 1}/${totalPages}`;

  return { text, keyboard: rows, totalPages, currentPage };
}

function grid(items, prefix, cols = 2) {
  const rows = [];
  for (let i = 0; i < items.length; i += cols) {
    rows.push(
      items.slice(i, i + cols).map(item => ({
        text: item,
        callback_data: `${prefix}|||${item}`,
      }))
    );
  }
  rows.push([{ text: "❌ Bekor qilish", callback_data: "cancel" }]);
  return rows;
}

function mainKbd() {
  return {
    inline_keyboard: [
      [{ text: "📋 Navbat olish",       callback_data: "menu_navbat" }],
      [{ text: "👁 Navbatlarni ko'rish", callback_data: "menu_view"   }],
    ],
  };
}

// ═══════════════════════════════════════════════════════════════
// ESLATMA TIZIMI
// ═══════════════════════════════════════════════════════════════
const reminderTimers = {}; // entry.num -> [timerId, timerId, ...]

function scheduleReminders(entry) {
  const timers = [];
  const now = new Date();
  const startTime = entry.startTime;
  const emoji = entry.carType === "yengil" ? "🚗" : "🚛";

  // Eslatma yuboruvchi funksiya
  function sendReminder(minutesLeft) {
    let message = "";

    if (minutesLeft === 120) {
      message =
        `🔔 *Eslatma — Samoyka*\n\n` +
        `${emoji} *${entry.car}* | ${entry.color}\n` +
        `🏪 ${entry.laneName}\n` +
        `🕐 Navbat vaqti: *${fmt(entry.startTime)}*\n\n` +
        `⏰ *2 soat qoldi!*\n` +
        `Tayyor bo'lib turing!`;
    } else if (minutesLeft === 60) {
      message =
        `🔔 *Eslatma — Samoyka*\n\n` +
        `${emoji} *${entry.car}* | ${entry.color}\n` +
        `🏪 ${entry.laneName}\n` +
        `🕐 Navbat vaqti: *${fmt(entry.startTime)}*\n\n` +
        `⏰ *1 soat qoldi!*\n` +
        `Tayyor bo'lib turing!`;
    } else if (minutesLeft === 30) {
      message =
        `⚠️ *Eslatma — Samoyka*\n\n` +
        `${emoji} *${entry.car}* | ${entry.color}\n` +
        `🏪 ${entry.laneName}\n` +
        `🕐 Navbat vaqti: *${fmt(entry.startTime)}*\n\n` +
        `⏰ *30 daqiqa qoldi!*\n` +
        `Yo'lga chiqishni boshlang! 🚦`;
    } else if (minutesLeft === 15) {
      message =
        `🚨 *Eslatma — Samoyka*\n\n` +
        `${emoji} *${entry.car}* | ${entry.color}\n` +
        `🏪 ${entry.laneName}\n` +
        `🕐 Navbat vaqti: *${fmt(entry.startTime)}*\n\n` +
        `⏰ *15 daqiqa qoldi!*\n` +
        `Tezroq yo'lga chiqing! 🏃`;
    }

    if (message) {
      bot.sendMessage(entry.userId, message, {
        parse_mode: "Markdown",
        reply_markup: mainKbd(),
      }).catch(() => {});
    }
  }

  // Har bir eslatma vaqtini hisoblash
  const reminderMinutes = [120, 60, 30, 15];

  for (const minLeft of reminderMinutes) {
    const reminderTime = new Date(startTime.getTime() - minLeft * 60000);
    const delay = reminderTime.getTime() - now.getTime();

    if (delay > 0) {
      const timerId = setTimeout(() => {
        sendReminder(minLeft);
      }, delay);
      timers.push(timerId);
    }
  }

  // Saqlash (bekor qilinsa to'xtatish uchun)
  reminderTimers[entry.num] = timers;
}

function cancelReminders(entryNum) {
  const timers = reminderTimers[entryNum];
  if (timers) {
    timers.forEach(t => clearTimeout(t));
    delete reminderTimers[entryNum];
  }
}

// ═══════════════════════════════════════════════════════════════
// /start
// ═══════════════════════════════════════════════════════════════
bot.onText(/\/start/, (msg) => {
  const name = msg.from.first_name || "Foydalanuvchi";
  bot.sendMessage(
    msg.chat.id,
    `🚗💦 *Samoyka Botga xush kelibsiz, ${name}!*\n\n` +
    `🏪 Bizda *3 ta kalanoka* mavjud:\n` +
    `🚗 1-kalanoka — Yengil mashinalar (30 min)\n` +
    `🚗 2-kalanoka — Yengil mashinalar (30 min)\n` +
    `🚛 3-kalanoka — Yuk mashinalar (60 min)\n\n` +
    `🕐 Ish vaqti: *08:00 — 23:00*\n` +
    `💳 Oldindan to'lov orqali joy band qilinadi\n\n` +
    `Quyidagi tugmani bosing 👇`,
    { parse_mode: "Markdown", reply_markup: mainKbd() }
  );
});

// ═══════════════════════════════════════════════════════════════
// CALLBACK QUERY
// ═══════════════════════════════════════════════════════════════
bot.on("callback_query", async (query) => {
  const chatId = query.message.chat.id;
  const msgId  = query.message.message_id;
  const userId = query.from.id;
  const data   = query.data;

  await bot.answerCallbackQuery(query.id).catch(() => {});

  const state = userState[userId] || {};

  // ── Bekor qilish ──────────────────────────────────────────
  if (data === "cancel") {
    delete userState[userId];
    return bot.editMessageText(
      "🏠 *Asosiy menyu*",
      { chat_id: chatId, message_id: msgId, parse_mode: "Markdown", reply_markup: mainKbd() }
    ).catch(() => {});
  }

  // ── Navbatlarni ko'rish ───────────────────────────────────
  if (data === "menu_view") {
    let txt = "";
    for (const lane of LANES) {
      const active = laneQueues[lane.id].filter(e => e.status === "pending" || e.status === "confirmed");
      const emoji  = lane.type === "yengil" ? "🚗" : "🚛";
      const nextFree = getNextSlot(lane.id);
      txt += `${emoji} *${lane.name}* — Bo'shaydi: *${fmt(nextFree)}*\n`;
      if (active.length === 0) {
        txt += `   ✅ Bo'sh\n\n`;
      } else {
        active.forEach((q, i) => {
          const statusIcon = q.status === "pending" ? "⏳" : "🟢";
          txt +=
            `   ${statusIcon} *#${q.num}* ${q.car} | ${q.color}\n` +
            `   📞 ${q.phone} | 🕐 ${fmt(q.startTime)} — ${fmt(q.endTime)}\n` +
            `   ${q.status === "pending" ? "_⏳ Kutilmoqda_" : "_✅ Tasdiqlangan_"}\n`;
        });
        txt += "\n";
      }
    }
    return bot.editMessageText(
      `📊 *Kalanokalar holati:*\n\n⏳ — kutilmoqda | 🟢 — tasdiqlangan\n\n${txt}`,
      {
        chat_id: chatId, message_id: msgId, parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: "🔄 Yangilash",       callback_data: "menu_view"   }],
            [{ text: "📋 Navbat olish",    callback_data: "menu_navbat" }],
          ],
        },
      }
    ).catch(() => {});
  }

  // ── Navbat olish: mashina turi ────────────────────────────
  if (data === "menu_navbat") {
    userState[userId] = { step: "type" };
    return bot.editMessageText(
      "🚗 *Mashina turini tanlang:*",
      {
        chat_id: chatId, message_id: msgId, parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: "🚗 Yengil mashina", callback_data: "type|||yengil" }],
            [{ text: "🚛 Yuk mashina",    callback_data: "type|||yuk"    }],
            [{ text: "❌ Bekor qilish",   callback_data: "cancel"        }],
          ],
        },
      }
    ).catch(() => {});
  }

  // ── Mashina turi tanlandi ─────────────────────────────────
  if (data.startsWith("type|||")) {
    const carType = data.split("|||")[1];
    userState[userId] = { step: "car", carType };
    const list  = carType === "yengil" ? YENGIL_CARS : YUK_CARS;
    const emoji = carType === "yengil" ? "🚗" : "🚛";
    return bot.editMessageText(
      `${emoji} *Mashina modelini tanlang:*`,
      {
        chat_id: chatId, message_id: msgId, parse_mode: "Markdown",
        reply_markup: { inline_keyboard: grid(list, "car") },
      }
    ).catch(() => {});
  }

  // ── Mashina modeli tanlandi ───────────────────────────────
  if (data.startsWith("car|||") && state.step === "car") {
    const car = data.split("|||")[1];
    userState[userId] = { ...state, step: "color", car };
    return bot.editMessageText(
      `${state.carType === "yengil" ? "🚗" : "🚛"} *${car}*\n\n🎨 *Rangni tanlang:*`,
      {
        chat_id: chatId, message_id: msgId, parse_mode: "Markdown",
        reply_markup: { inline_keyboard: grid(COLORS, "color") },
      }
    ).catch(() => {});
  }

  // ── Rang tanlandi → telefon so'rash ──────────────────────
  if (data.startsWith("color|||") && state.step === "color") {
    const color = data.split("|||")[1];
    userState[userId] = { ...state, step: "phone", color };

    await bot.editMessageText(
      `${state.carType === "yengil" ? "🚗" : "🚛"} *${state.car}* | ${color}\n\n` +
      `📞 *Telefon raqamingizni yuboring:*\n\n` +
      `Pastdagi tugmani bosib Telegram raqamingizni ulashing\n` +
      `yoki qo'lda yozing: +998901234567`,
      {
        chat_id: chatId, message_id: msgId, parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: "⬅️ Orqaga (rang o'zgartirish)", callback_data: "back_color" }],
            [{ text: "❌ Bekor qilish",                callback_data: "cancel"     }],
          ],
        },
      }
    ).catch(() => {});

    return bot.sendMessage(
      chatId,
      "👇 Raqamni ulashish uchun bosing:",
      {
        reply_markup: {
          keyboard: [[{ text: "📱 Telegram raqamni ulashish", request_contact: true }]],
          resize_keyboard: true, one_time_keyboard: true,
        },
      }
    );
  }

  // ── Orqaga: rang → mashina modeli ────────────────────────
  if (data === "back_color" && (state.step === "phone" || state.step === "time" || state.step === "payment")) {
    userState[userId] = { ...state, step: "color", color: undefined };
    return bot.editMessageText(
      `${state.carType === "yengil" ? "🚗" : "🚛"} *${state.car}*\n\n🎨 *Rangni tanlang:*`,
      {
        chat_id: chatId, message_id: msgId, parse_mode: "Markdown",
        reply_markup: { inline_keyboard: grid(COLORS, "color") },
      }
    ).catch(() => {});
  }

  // ═══════════════════════════════════════════════════════════
  // VAQT TANLASH
  // ═══════════════════════════════════════════════════════════

  if (data.startsWith("timepage|||") && state.step === "time") {
    const page = parseInt(data.split("|||")[1]) || 0;
    const { text, keyboard } = getTimeSlotKeyboard(state.carType, page);
    return bot.editMessageText(text, {
      chat_id: chatId, message_id: msgId, parse_mode: "Markdown",
      reply_markup: { inline_keyboard: keyboard },
    }).catch(() => {});
  }

  if (data.startsWith("time_busy|||") && state.step === "time") {
    const parts = data.split("|||")[1].split("-");
    const startMin = parseInt(parts[0]);
    const endMin   = parseInt(parts[1]);
    const startH   = Math.floor(startMin / 60);
    const startM   = startMin % 60;
    const endH     = Math.floor(endMin / 60);
    const endM     = endMin % 60;
    const label    = `${fmtTime(startH, startM)} - ${fmtTime(endH, endM)}`;

    await bot.answerCallbackQuery(query.id, {
      text: `❌ ${label} — bu vaqt band! Boshqa vaqt tanlang.`,
      show_alert: true,
    }).catch(() => {});
    return;
  }

  // ── Vaqt tanlandi → TO'LOV SAHIFASI ───────────────────────
  if (data.startsWith("time|||") && state.step === "time") {
    const parts    = data.split("|||")[1].split("-");
    const startMin = parseInt(parts[0]);
    const endMin   = parseInt(parts[1]);

    const lane = getAvailableLaneForSlot(state.carType, startMin, endMin);
    if (!lane) {
      await bot.answerCallbackQuery(query.id, {
        text: "❌ Afsuski bu vaqt band bo'ldi. Boshqa vaqt tanlang.",
        show_alert: true,
      }).catch(() => {});

      const { text, keyboard } = getTimeSlotKeyboard(state.carType, 0);
      return bot.editMessageText(text, {
        chat_id: chatId, message_id: msgId, parse_mode: "Markdown",
        reply_markup: { inline_keyboard: keyboard },
      }).catch(() => {});
    }

    const now       = new Date();
    const startTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), Math.floor(startMin / 60), startMin % 60);
    const endTime   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), Math.floor(endMin / 60), endMin % 60);

    userState[userId] = {
      ...state,
      step: "payment",
      laneId: lane.id,
      laneName: lane.name,
      startMin, endMin, startTime, endTime,
    };

    const startH = Math.floor(startMin / 60);
    const startM = startMin % 60;
    const endH   = Math.floor(endMin / 60);
    const endM   = endMin % 60;

    const paymentText =
      `💳 💳 💳 *TO\'LOV QILISH* 💳 💳 💳\n\n` +
      `Siz tanlagan:\n` +
      `🏪 Kalanoka: *${lane.name}*\n` +
      `🕐 Vaqt: *${fmtTime(startH, startM)} — ${fmtTime(endH, endM)}*\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `💳 Quyidagi karta raqamiga to\'lov qiling:\n\n` +
      `💰 *8600 0609 9498 4103*\n` +
      `👤 Karta egasi: *${CARD_HOLDER}*\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `📸 To\'lov qilgach, chek rasmini yuboring!\n` +
      `Admin tekshirib, joyni tasdiqlaydi.\n\n` +
      `⚠️ Chek yubormasangiz buyurtma qabul qilinmaydi!`;

    return bot.editMessageText(paymentText, {
      chat_id: chatId,
      message_id: msgId,
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "⬅️ Orqaga (vaqt o'zgartirish)", callback_data: "back_time" }],
          [{ text: "❌ Bekor qilish", callback_data: "cancel" }],
        ],
      },
    }).catch(() => {});
  }

  // ── Orqaga: to'lov → vaqt tanlash ────────────────────────
  if (data === "back_time" && state.step === "payment") {
    userState[userId] = { ...state, step: "time" };
    const { text, keyboard } = getTimeSlotKeyboard(state.carType, 0);
    return bot.editMessageText(text, {
      chat_id: chatId, message_id: msgId, parse_mode: "Markdown",
      reply_markup: { inline_keyboard: keyboard },
    }).catch(() => {});
  }

  // ═══════════════════════════════════════════════════════════
  // ADMIN: QABUL / BEKOR / TAYYOR
  // ═══════════════════════════════════════════════════════════

  // ── Admin: QABUL QILISH ──────────────────────────────────
  if (data.startsWith("accept|||")) {
    const parts  = data.split("|||");
    const num    = parseInt(parts[1]);
    const laneId = parseInt(parts[2]);
    const item   = laneQueues[laneId]?.find(e => e.num === num);

    if (!item) {
      return bot.answerCallbackQuery(query.id, { text: "⚠️ Buyurtma topilmadi.", show_alert: true }).catch(() => {});
    }
    if (item.status === "confirmed") {
      return bot.answerCallbackQuery(query.id, { text: "⚠️ Allaqachon qabul qilingan.", show_alert: true }).catch(() => {});
    }
    if (item.status === "cancelled") {
      return bot.answerCallbackQuery(query.id, { text: "⚠️ Allaqachon bekor qilingan.", show_alert: true }).catch(() => {});
    }

    item.status = "confirmed";

    // ✅ Eslatmalarni rejalashtirish
    scheduleReminders(item);

    await bot.editMessageText(
      `✅ *#${item.num} — Qabul qilindi*\n\n` +
      `${item.carType === "yengil" ? "🚗" : "🚛"} ${item.car} | ${item.color}\n` +
      `🏪 ${item.laneName}\n` +
      `📞 ${item.phone}\n` +
      `🕐 ${fmt(item.startTime)} → ${fmt(item.endTime)}\n\n✅ Tasdiqlangan`,
      {
        chat_id: chatId, message_id: msgId, parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [[
            { text: `🏁 #${item.num} Tayyor`, callback_data: `done|||${item.num}|||${item.laneId}` }
          ]]
        }
      }
    ).catch(() => {});

    bot.sendMessage(
      item.userId,
      `✅ *Buyurtmangiz tasdiqlandi!*\n\n` +
      `🔢 Navbat: *#${item.num}*\n` +
      `🏪 Kalanoka: *${item.laneName}*\n` +
      `${item.carType === "yengil" ? "🚗" : "🚛"} ${item.car} | ${item.color}\n` +
      `🕐 Vaqt: *${fmt(item.startTime)} — ${fmt(item.endTime)}*\n\n` +
      `🔔 Navbat vaqtidan oldin eslatma xabarlari keladi!\n` +
      `📌 Vaqtingizda keling!`,
      { parse_mode: "Markdown", reply_markup: mainKbd() }
    );
    return;
  }

  // ── Admin: BEKOR QILISH ──────────────────────────────────
  if (data.startsWith("reject|||")) {
    const parts  = data.split("|||");
    const num    = parseInt(parts[1]);
    const laneId = parseInt(parts[2]);
    const item   = laneQueues[laneId]?.find(e => e.num === num);

    if (!item) {
      return bot.answerCallbackQuery(query.id, { text: "⚠️ Buyurtma topilmadi.", show_alert: true }).catch(() => {});
    }
    if (item.status === "cancelled") {
      return bot.answerCallbackQuery(query.id, { text: "⚠️ Allaqachon bekor qilingan.", show_alert: true }).catch(() => {});
    }
    if (item.status === "confirmed") {
      return bot.answerCallbackQuery(query.id, { text: "⚠️ Tasdiqlangan buyurtmani bekor qilib bo'lmaydi.", show_alert: true }).catch(() => {});
    }

    item.status = "cancelled";

    // ❌ Eslatmalarni bekor qilish
    cancelReminders(item.num);

    await bot.editMessageText(
      `❌ *#${item.num} — Bekor qilindi*\n\n` +
      `${item.carType === "yengil" ? "🚗" : "🚛"} ${item.car} | ${item.color}\n` +
      `🏪 ${item.laneName}\n` +
      `📞 ${item.phone}\n` +
      `🕐 ${fmt(item.startTime)} → ${fmt(item.endTime)}\n\n❌ Rad etilgan — pul qaytariladi`,
      { chat_id: chatId, message_id: msgId, parse_mode: "Markdown" }
    ).catch(() => {});

    bot.sendMessage(
      item.userId,
      `❌ *Buyurtmangiz bekor qilindi*\n\n` +
      `🔢 Navbat: *#${item.num}*\n` +
      `${item.carType === "yengil" ? "🚗" : "🚛"} ${item.car} | ${item.color}\n` +
      `🕐 ${fmt(item.startTime)} — ${fmt(item.endTime)}\n\n` +
      `⚠️ Admin to'lovni tasdiqlamadi.\nPulingiz qaytariladi.\nIltimos qayta navbat oling.`,
      { parse_mode: "Markdown", reply_markup: mainKbd() }
    );
    return;
  }

  // ── Admin: TAYYOR ────────────────────────────────────────
  if (data.startsWith("done|||")) {
    const parts  = data.split("|||");
    const num    = parseInt(parts[1]);
    const laneId = parseInt(parts[2]);
    const item   = laneQueues[laneId]?.find(e => e.num === num);

    if (item && !item.done) {
      item.done = true;
      item.status = "done";

      // ✅ Eslatmalarni to'xtatish (agar hali bormagan bo'lsa)
      cancelReminders(item.num);

      await bot.editMessageText(
        `✅ *#${item.num} — Yuvish tugallandi*\n` +
        `${item.carType === "yengil" ? "🚗" : "🚛"} ${item.car} | ${item.color}\n` +
        `🏪 ${item.laneName}`,
        { chat_id: chatId, message_id: msgId, parse_mode: "Markdown" }
      ).catch(() => {});

      bot.sendMessage(
        item.userId,
        `🎉 *Sizning mashinangiz tayyor!*\n\n` +
        `${item.carType === "yengil" ? "🚗" : "🚛"} ${item.car} | ${item.color}\n` +
        `🏪 ${item.laneName}\n\nRahmat, qayta keling! 👋`,
        { parse_mode: "Markdown", reply_markup: mainKbd() }
      );
    } else {
      bot.sendMessage(chatId, "⚠️ Bu navbat allaqachon belgilangan.");
    }
    return;
  }
});

// ═══════════════════════════════════════════════════════════════
// MATN VA RASM XABARLARI
// ═══════════════════════════════════════════════════════════════
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text   = msg.text || "";
  const state  = userState[userId] || {};

  if (text.startsWith("/start")) return;

  // ═══════════════════════════════════════════════════════════
  // ADMIN PANEL
  // ═══════════════════════════════════════════════════════════
  if (text === "/admin") {
    if (isAdmin(chatId)) {
      return showAdminPanel(chatId);
    }
    userState[userId] = { step: "admin_code" };
    return bot.sendMessage(chatId, "🔐 *Admin paneliga kirish*\n\nMaxfiy kodni yuboring:", { parse_mode: "Markdown" });
  }

  if (state.step === "admin_code") {
    if (text === ADMIN_CODE) {
      adminSessions[chatId] = { active: true, expiresAt: Date.now() + 60 * 60 * 1000 };
      delete userState[userId];
      bot.sendMessage(chatId, "✅ *Admin paneliga kirish muvaffaqiyatli!*", { parse_mode: "Markdown" });
      return showAdminPanel(chatId);
    } else {
      delete userState[userId];
      return bot.sendMessage(chatId, "❌ *Noto'g'ri kod!*", { parse_mode: "Markdown" });
    }
  }

  // ═══════════════════════════════════════════════════════════
  // TO'LOV: CHEK RASMINI QABUL QILISH
  // ═══════════════════════════════════════════════════════════
  if (state.step === "payment" && msg.photo) {
    const photo = msg.photo[msg.photo.length - 1];
    const fileId = photo.file_id;

    const entry = {
      num: counter++,
      userId,
      phone: state.phone,
      car: state.car,
      color: state.color,
      carType: state.carType,
      laneId: state.laneId,
      laneName: state.laneName,
      startTime: state.startTime,
      endTime: state.endTime,
      status: "pending",
      done: false,
      receiptFileId: fileId,
    };
    laneQueues[state.laneId].push(entry);
    delete userState[userId];

    const startH = Math.floor(state.startMin / 60);
    const startM = state.startMin % 60;
    const endH   = Math.floor(state.endMin / 60);
    const endM   = state.endMin % 60;

    await bot.sendMessage(
      chatId,
      `✅ *To'lov cheki qabul qilindi!*\n\n` +
      `🔢 Navbat: *#${entry.num}*\n` +
      `🏪 Kalanoka: *${entry.laneName}*\n` +
      `📞 Telefon: ${state.phone}\n` +
      `${entry.carType === "yengil" ? "🚗" : "🚛"} Mashina: ${entry.car}\n` +
      `🎨 Rang: ${entry.color}\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🕐 Vaqt: *${fmtTime(startH, startM)} — ${fmtTime(endH, endM)}*\n` +
      `━━━━━━━━━━━━━━━━━━━━\n\n` +
      `⏳ *Holat: Kutilmoqda*\n` +
      `Admin to'lovni tekshirib tasdiqlaydi.\n` +
      `🔔 Tasdiqlangach, eslatma xabarlari keladi!`,
      { parse_mode: "Markdown", reply_markup: mainKbd() }
    );

    if (ADMIN_ID) {
      await bot.sendPhoto(ADMIN_ID, fileId, {
        caption:
          `🧾 *TO'LOV CHEKI — #${entry.num}*\n\n` +
          `🏪 ${entry.laneName} | ${entry.carType === "yengil" ? "🚗" : "🚛"} ${entry.car}\n` +
          `🎨 ${entry.color}\n` +
          `📞 ${state.phone}\n` +
          `🕐 ${fmtTime(startH, startM)} → ${fmtTime(endH, endM)}`,
        parse_mode: "Markdown",
      });

      bot.sendMessage(ADMIN_ID, `👇 *#${entry.num} buyurtma:*`, {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: `✅ Qabul qilish #${entry.num}`, callback_data: `accept|||${entry.num}|||${entry.laneId}` }],
            [{ text: `❌ Bekor qilish #${entry.num}`, callback_data: `reject|||${entry.num}|||${entry.laneId}` }],
          ],
        }
      });
    }
    return;
  }

  if (state.step === "payment" && text && !text.startsWith("/")) {
    return bot.sendMessage(
      chatId,
      `📸 *Iltimos, to'lov chekining RASMINI yuboring!*\n\n` +
      `Matn yozmang — rasm yuboring!\n\n` +
      `💳 Karta raqam:\n` +
      `*8600 0609 9498 4103*\n` +
      `👤 ${CARD_HOLDER}`,
      { parse_mode: "Markdown" }
    );
  }

  // ═══════════════════════════════════════════════════════════
  // TELEFON RAQAM
  // ═══════════════════════════════════════════════════════════
  if (state.step === "phone") {
    let phone = "";

    if (msg.contact) {
      phone = msg.contact.phone_number;
      if (!phone.startsWith("+")) phone = "+" + phone;
    } else if (text.match(/^\+?[0-9\s\-]{9,15}$/)) {
      phone = text;
    } else {
      return bot.sendMessage(
        chatId,
        "❗ Noto'g'ri format. Qaytadan kiriting: `+998901234567`",
        { parse_mode: "Markdown" }
      );
    }

    await bot.sendMessage(chatId, "⏳ Vaqtlar yuklanmoqda...", {
      reply_markup: { remove_keyboard: true },
    }).then(m => bot.deleteMessage(chatId, m.message_id).catch(() => {}));

    userState[userId] = { ...state, step: "time", phone };

    const { text: slotText, keyboard } = getTimeSlotKeyboard(state.carType, 0);

    return bot.sendMessage(chatId, slotText, {
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: keyboard },
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// ADMIN PANEL
// ═══════════════════════════════════════════════════════════════
function showAdminPanel(chatId) {
  let hasAny = false;

  for (const lane of LANES) {
    const pending   = laneQueues[lane.id].filter(e => e.status === "pending");
    const confirmed = laneQueues[lane.id].filter(e => e.status === "confirmed");

    for (const q of pending) {
      hasAny = true;
      if (q.receiptFileId) {
        bot.sendPhoto(chatId, q.receiptFileId, {
          caption:
            `⏳ *KUTILMOQDA* — ${lane.type === "yengil" ? "🚗" : "🚛"} *${lane.name}* | *#${q.num}*\n\n` +
            `${q.car} | ${q.color}\n` +
            `📞 ${q.phone}\n` +
            `🕐 ${fmt(q.startTime)} → ${fmt(q.endTime)}\n\n` +
            `🧾 To'lov cheki yuqorida`,
          parse_mode: "Markdown",
        });
      }
      bot.sendMessage(chatId, `❗ *Tasdiqlash kutilmoqda — #${q.num}*`, {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: `✅ Qabul qilish #${q.num}`, callback_data: `accept|||${q.num}|||${q.laneId}` }],
            [{ text: `❌ Bekor qilish #${q.num}`, callback_data: `reject|||${q.num}|||${q.laneId}` }],
          ],
        }
      });
    }

    for (const q of confirmed) {
      hasAny = true;
      bot.sendMessage(
        chatId,
        `✅ *TASDIQLANGAN* — ${lane.type === "yengil" ? "🚗" : "🚛"} *${lane.name}* | *#${q.num}*\n\n` +
        `${q.car} | ${q.color}\n` +
        `📞 ${q.phone}\n` +
        `🕐 ${fmt(q.startTime)} → ${fmt(q.endTime)}`,
        {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [[
              { text: `🏁 #${q.num} Tayyor`, callback_data: `done|||${q.num}|||${q.laneId}` }
            ]]
          }
        }
      );
    }
  }

  if (!hasAny) {
    bot.sendMessage(chatId, "📋 Barcha kalanokalar bo'sh.", { reply_markup: mainKbd() });
  }
}

function getNextSlot(laneId) {
  const active = laneQueues[laneId].filter(e => e.status === "pending" || e.status === "confirmed");
  if (active.length === 0) return new Date();
  return new Date(active[active.length - 1].endTime);
}

console.log("🚗💦 Samoyka Bot ishga tushdi!");