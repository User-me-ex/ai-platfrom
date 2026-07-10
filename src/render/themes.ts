/**
 * 9 Router CLI — Theme Definitions
 */

import chalk from "chalk";

/** Alias for chalk instance type - compatible across chalk v4 and v5 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ChalkInstance = any;

export interface Theme {
  name: string;
  type: "dark" | "light";

  // Semantic colors
  primary: ChalkInstance;
  secondary: ChalkInstance;
  accent: ChalkInstance;
  success: ChalkInstance;
  warning: ChalkInstance;
  error: ChalkInstance;
  info: ChalkInstance;

  // Text colors
  text: ChalkInstance;
  textDim: ChalkInstance;
  textBright: ChalkInstance;
  textInverse: ChalkInstance;

  // UI colors
  border: ChalkInstance;
  borderDim: ChalkInstance;
  background: ChalkInstance;
  backgroundAlt: ChalkInstance;

  // Syntax-like colors (for keyword-style highlighting)
  keyword: ChalkInstance;
  string: ChalkInstance;
  number: ChalkInstance;
  comment: ChalkInstance;
  function: ChalkInstance;
  variable: ChalkInstance;

  // Special
  link: ChalkInstance;
  code: ChalkInstance;
  quote: ChalkInstance;
  list: ChalkInstance;
  heading: (level: number) => ChalkInstance;
}

/** Dark theme (default) */
export const darkTheme: Theme = {
  name: "dark",
  type: "dark",

  primary: chalk.hex("#BB86FC"),
  secondary: chalk.hex("#03DAC6"),
  accent: chalk.hex("#FF7597"),
  success: chalk.hex("#4CAF50"),
  warning: chalk.hex("#FFB74D"),
  error: chalk.hex("#FF5252"),
  info: chalk.hex("#64B5F6"),

  text: chalk.hex("#E0E0E0"),
  textDim: chalk.hex("#9E9E9E"),
  textBright: chalk.white,
  textInverse: chalk.black,

  border: chalk.hex("#616161"),
  borderDim: chalk.hex("#424242"),
  background: chalk.hex("#1E1E1E"),
  backgroundAlt: chalk.hex("#252526"),

  keyword: chalk.hex("#C792EA"),
  string: chalk.hex("#C3E88D"),
  number: chalk.hex("#F78C6C"),
  comment: chalk.hex("#676E95"),
  function: chalk.hex("#82AAFF"),
  variable: chalk.hex("#EEFFFF"),

  link: chalk.hex("#64B5F6").underline,
  code: chalk.hex("#FFCB6B"),
  quote: chalk.hex("#9E9E9E").italic,
  list: chalk.hex("#82AAFF"),
  heading: (level: number) => {
    const colors = [
      chalk.hex("#FF5370").bold,
      chalk.hex("#FFB74D").bold,
      chalk.hex("#64B5F6").bold,
      chalk.hex("#C792EA").bold,
    ];
    return colors[Math.min(level - 1, colors.length - 1)] ?? chalk.white.bold;
  },
};

/** Light theme */
export const lightTheme: Theme = {
  name: "light",
  type: "light",

  primary: chalk.hex("#6200EE"),
  secondary: chalk.hex("#018786"),
  accent: chalk.hex("#C51162"),
  success: chalk.hex("#2E7D32"),
  warning: chalk.hex("#FF8F00"),
  error: chalk.hex("#D50000"),
  info: chalk.hex("#1565C0"),

  text: chalk.hex("#212121"),
  textDim: chalk.hex("#757575"),
  textBright: chalk.black,
  textInverse: chalk.white,

  border: chalk.hex("#BDBDBD"),
  borderDim: chalk.hex("#E0E0E0"),
  background: chalk.hex("#FAFAFA"),
  backgroundAlt: chalk.hex("#F5F5F5"),

  keyword: chalk.hex("#7B1FA2"),
  string: chalk.hex("#558B2F"),
  number: chalk.hex("#E65100"),
  comment: chalk.hex("#9E9E9E").italic,
  function: chalk.hex("#1A237E"),
  variable: chalk.hex("#212121"),

  link: chalk.hex("#1565C0").underline,
  code: chalk.hex("#F57F17"),
  quote: chalk.hex("#757575").italic,
  list: chalk.hex("#1A237E"),
  heading: (level: number) => {
    const colors = [
      chalk.hex("#D50000").bold,
      chalk.hex("#FF8F00").bold,
      chalk.hex("#1565C0").bold,
      chalk.hex("#7B1FA2").bold,
    ];
    return colors[Math.min(level - 1, colors.length - 1)] ?? chalk.black.bold;
  },
};

const themeRegistry: Record<string, Theme> = {
  dark: darkTheme,
  light: lightTheme,
};

/** Get a theme by name */
export function getTheme(name: string): Theme {
  return themeRegistry[name] ?? darkTheme;
}

/** Register a custom theme */
export function registerTheme(name: string, theme: Theme): void {
  themeRegistry[name] = theme;
}
