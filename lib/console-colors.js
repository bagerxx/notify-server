const COLORS = {
  reset: '\x1b[0m',
  gray: '\x1b[90m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

const USE_COLOR = Boolean(process.stdout.isTTY);

function colorize(text, color) {
  if (!USE_COLOR) return text;
  return `${color}${text}${COLORS.reset}`;
}

export {
  COLORS,
  colorize,
  USE_COLOR,
};
