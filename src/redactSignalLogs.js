// libsignal logs whole SessionEntry objects (including private ratchet keys)
// through console.info/warn. Keep the lifecycle event without the object.
const sessionMessages = new Set([
  'Closing session:',
  'Opening session:',
  'Removing old closed session:',
  'Session already closed',
]);

for (const method of ['info', 'warn']) {
  const original = console[method].bind(console);
  console[method] = (...args) => {
    if (sessionMessages.has(args[0])) {
      original('[libsignal] Session lifecycle event');
      return;
    }
    original(...args);
  };
}
