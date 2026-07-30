import type { editor } from "monaco-editor";
import type { ResolvedColorScheme, Theme } from "./theme";

const FIXED_MONACO_THEMES: Record<
  Exclude<Theme, "liquid-glass">,
  editor.IStandaloneThemeData
> = {
  green: {
    base: "vs-dark",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": "#0a1210",
      "editorGutter.background": "#0a1210",
      "editorLineNumber.foreground": "#496057",
      "editorLineNumber.activeForeground": "#9bb5aa",
      "diffEditor.insertedTextBackground": "#1f7a5242",
      "diffEditor.removedTextBackground": "#b64b5542",
      "diffEditor.insertedLineBackground": "#123b2b88",
      "diffEditor.removedLineBackground": "#3d202588",
      "diffEditor.diagonalFill": "#18231f",
      "editorOverviewRuler.addedForeground": "#67dba0",
      "editorOverviewRuler.deletedForeground": "#f2777f",
      "scrollbarSlider.background": "#66807433",
      "scrollbarSlider.hoverBackground": "#78998a66",
    },
  },
  dark: {
    base: "vs-dark",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": "#171717",
      "editorGutter.background": "#171717",
      "editorLineNumber.foreground": "#737373",
      "editorLineNumber.activeForeground": "#d4d4d4",
      "diffEditor.insertedTextBackground": "#2f7d4d55",
      "diffEditor.removedTextBackground": "#a94c5555",
      "diffEditor.insertedLineBackground": "#173d2788",
      "diffEditor.removedLineBackground": "#43232988",
      "diffEditor.diagonalFill": "#262626",
      "editorOverviewRuler.addedForeground": "#57c785",
      "editorOverviewRuler.deletedForeground": "#ef7a82",
      "scrollbarSlider.background": "#77777733",
      "scrollbarSlider.hoverBackground": "#99999966",
    },
  },
  light: {
    base: "vs",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": "#ffffff",
      "editorGutter.background": "#ffffff",
      "editorLineNumber.foreground": "#8b8b8b",
      "editorLineNumber.activeForeground": "#333333",
      "diffEditor.insertedTextBackground": "#60b8784a",
      "diffEditor.removedTextBackground": "#e06c754a",
      "diffEditor.insertedLineBackground": "#dff4e688",
      "diffEditor.removedLineBackground": "#f9dfe288",
      "diffEditor.diagonalFill": "#eeeeee",
      "editorOverviewRuler.addedForeground": "#258a52",
      "editorOverviewRuler.deletedForeground": "#c44550",
      "scrollbarSlider.background": "#77777733",
      "scrollbarSlider.hoverBackground": "#66666655",
    },
  },
  glass: {
    base: "vs-dark",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": "#0b1622",
      "editorGutter.background": "#0b1622",
      "editorLineNumber.foreground": "#557087",
      "editorLineNumber.activeForeground": "#c7dceb",
      "diffEditor.insertedTextBackground": "#2b9b7350",
      "diffEditor.removedTextBackground": "#c35f6c50",
      "diffEditor.insertedLineBackground": "#123b3488",
      "diffEditor.removedLineBackground": "#42263388",
      "diffEditor.diagonalFill": "#152436",
      "editorOverviewRuler.addedForeground": "#72dfbd",
      "editorOverviewRuler.deletedForeground": "#f28691",
      "scrollbarSlider.background": "#8fb3ca2b",
      "scrollbarSlider.hoverBackground": "#a8c8db55",
    },
  },
  neumorphic: {
    base: "vs-dark",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": "#101922",
      "editorGutter.background": "#101922",
      "editorLineNumber.foreground": "#566b79",
      "editorLineNumber.activeForeground": "#c8d8df",
      "diffEditor.insertedTextBackground": "#297a5e55",
      "diffEditor.removedTextBackground": "#a84d5a55",
      "diffEditor.insertedLineBackground": "#15372e88",
      "diffEditor.removedLineBackground": "#3b252d88",
      "diffEditor.diagonalFill": "#192732",
      "editorOverviewRuler.addedForeground": "#6bd8b6",
      "editorOverviewRuler.deletedForeground": "#eb808b",
      "scrollbarSlider.background": "#6c879833",
      "scrollbarSlider.hoverBackground": "#87a5b766",
    },
  },
};

const LIQUID_GLASS_MONACO_THEMES: Record<
  ResolvedColorScheme,
  editor.IStandaloneThemeData
> = {
  light: {
    base: "vs",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": "#f7f9fc",
      "editorGutter.background": "#f7f9fc",
      "editorLineNumber.foreground": "#8190a4",
      "editorLineNumber.activeForeground": "#243246",
      "diffEditor.insertedTextBackground": "#47a87945",
      "diffEditor.removedTextBackground": "#d85e6b40",
      "diffEditor.insertedLineBackground": "#d9f2e588",
      "diffEditor.removedLineBackground": "#f8dfe288",
      "diffEditor.diagonalFill": "#e6ebf2",
      "editorOverviewRuler.addedForeground": "#21855a",
      "editorOverviewRuler.deletedForeground": "#bd3f50",
      "scrollbarSlider.background": "#53657d2b",
      "scrollbarSlider.hoverBackground": "#42536a55",
    },
  },
  dark: {
    base: "vs-dark",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": "#111827",
      "editorGutter.background": "#111827",
      "editorLineNumber.foreground": "#617086",
      "editorLineNumber.activeForeground": "#d9e3ef",
      "diffEditor.insertedTextBackground": "#2c9a7052",
      "diffEditor.removedTextBackground": "#c95a6750",
      "diffEditor.insertedLineBackground": "#15382e88",
      "diffEditor.removedLineBackground": "#41232c88",
      "diffEditor.diagonalFill": "#1b2636",
      "editorOverviewRuler.addedForeground": "#66d9b5",
      "editorOverviewRuler.deletedForeground": "#f08491",
      "scrollbarSlider.background": "#93a6bd2b",
      "scrollbarSlider.hoverBackground": "#a9bad055",
    },
  },
};

export const MONACO_THEMES: Record<
  Theme,
  Record<ResolvedColorScheme, editor.IStandaloneThemeData>
> = {
  green: {
    light: FIXED_MONACO_THEMES.green,
    dark: FIXED_MONACO_THEMES.green,
  },
  dark: {
    light: FIXED_MONACO_THEMES.dark,
    dark: FIXED_MONACO_THEMES.dark,
  },
  light: {
    light: FIXED_MONACO_THEMES.light,
    dark: FIXED_MONACO_THEMES.light,
  },
  glass: {
    light: FIXED_MONACO_THEMES.glass,
    dark: FIXED_MONACO_THEMES.glass,
  },
  neumorphic: {
    light: FIXED_MONACO_THEMES.neumorphic,
    dark: FIXED_MONACO_THEMES.neumorphic,
  },
  "liquid-glass": LIQUID_GLASS_MONACO_THEMES,
};
