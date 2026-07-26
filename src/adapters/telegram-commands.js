const COMMANDS = new Set([
  '/start',
  '/service',
  '/generator',
  '/generac',
  '/maintenance',
  '/maint',
  '/help',
  '/support',
  '/terms'
]);

function commandName(text) {
  return String(text || '').split(/\s+/, 1)[0].split('@', 1)[0].toLowerCase();
}

function commandPayload(command, firstName, miniAppUrl) {
  const name = firstName || 'there';
  const keyboard = (label, startApp) => ({
    reply_markup: {
      keyboard: [[{
        text: label,
        web_app: { url: `${miniAppUrl}?startapp=${startApp}` }
      }]],
      resize_keyboard: true,
      one_time_keyboard: true
    }
  });
  const unavailable = {
    text: 'The Phoenix Electric Mini App is temporarily unavailable. Please try again later.',
    options: {}
  };

  if (command === '/terms') {
    return {
      text: 'Phoenix Electric estimates are subject to on-site evaluation. For help, call (720) 955-0284.',
      options: {}
    };
  }
  if (command === '/generator' || command === '/generac') {
    if (!miniAppUrl) return unavailable;
    return {
      text: `Hi ${name}. Open the Generac sizing tool below.`,
      options: keyboard('Size My Generator', 'generator')
    };
  }
  if (command === '/maintenance' || command === '/maint') {
    if (!miniAppUrl) return unavailable;
    return {
      text: `Hi ${name}. Open the generator maintenance request below.`,
      options: keyboard('Book Maintenance', 'maintenance')
    };
  }
  if (command === '/service') {
    if (!miniAppUrl) return unavailable;
    return {
      text: `Hi ${name}. Open a Phoenix Electric service request below.`,
      options: keyboard('Request Service', 'service')
    };
  }
  if (command === '/help' || command === '/support') {
    return {
      text: 'Commands: /service, /generator, /maintenance, /terms. For urgent help call (720) 955-0284.',
      options: {}
    };
  }
  if (!miniAppUrl) return unavailable;
  return {
    text: `Welcome to Phoenix Electric, ${name}. Choose a service below.`,
    options: keyboard('Open Phoenix Electric', 'service')
  };
}

export async function handleTelegramCommand(bot, message, miniAppUrl) {
  const command = commandName(message?.text);
  if (!COMMANDS.has(command)) {
    return false;
  }

  const chatId = message?.chat?.id;
  if (!chatId) {
    return false;
  }

  const payload = commandPayload(command, message?.from?.first_name, miniAppUrl);
  await bot.sendMessage(chatId, payload.text, payload.options);
  return true;
}
