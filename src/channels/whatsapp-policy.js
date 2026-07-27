export function normalizeWhatsAppGroupIds(value) {
  const values = Array.isArray(value) ? value : String(value || '').split(',');
  return [...new Set(values.map((entry) => String(entry).trim()).filter(Boolean))];
}

export function evaluateWhatsAppInbound(message, allowedGroupIds = []) {
  const chatId = String(message?.chatId || '').trim();
  const isGroup = message?.isGroup === true;
  const allowedGroups = new Set(normalizeWhatsAppGroupIds(allowedGroupIds));

  if (isGroup && !allowedGroups.has(chatId)) {
    return { accepted: false, reason: 'group_not_allowed' };
  }

  const text = String(message?.body || '').trim();
  if (!text) {
    return { accepted: false, reason: 'unsupported_or_empty_content' };
  }

  return { accepted: true, text };
}
