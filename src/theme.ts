import { extendTheme } from "@chakra-ui/react";

export const theme = extendTheme({
  config: {
    initialColorMode: "dark",
    useSystemColorMode: false,
  },
  sizes: {
    container: {
      xl: "1600px",
    },
  },
  styles: {
    global: () => ({
      body: {
        bg: "surface",
        color: "text.primary",
      },
    }),
  },
  fonts: {
    heading: `'Inter Variable', sans-serif`,
    body: `'Inter Variable', sans-serif`,
    ono: `'Source Code Pro Variable', monospace`,
  },
  shadows: {
    card: "0 1px 2px rgba(0,0,0,0.32), 0 1px 1px rgba(0,0,0,0.24)",
    cardHover: "0 4px 12px rgba(0,0,0,0.40)",
    panel: "0 2px 8px rgba(0,0,0,0.30)",
    focusAccent: "0 0 0 1px var(--chakra-colors-accent-400)",
  },
  components: {
    Input: {
      defaultProps: {
        variant: "filled",
        focusBorderColor: "accent",
      },
      baseStyle: { field: { borderRadius: "lg" } },
    },
    Textarea: {
      defaultProps: {
        variant: "filled",
        focusBorderColor: "accent",
      },
      baseStyle: { borderRadius: "lg" },
    },
    Select: {
      defaultProps: {
        variant: "filled",
        focusBorderColor: "accent",
      },
      baseStyle: { field: { borderRadius: "lg" } },
    },
    Code: {
      baseStyle: {
        bgColor: "surface.inset",
        borderRadius: "md",
        px: 2,
      },
    },
    Alert: {
      baseStyle: { container: { borderRadius: "xl" } },
      variants: {
        subtle: {
          container: {
            "&[data-status='success']": { bg: "#1f3d30E6" },
            "&[data-status='error']": { bg: "#7a2d2dE6" },
            "&[data-status='warning']": { bg: "#6e4a25E6" },
            "&[data-status='info']": { bg: "#234058E6" },
          },
        },
      },
    },
    Button: {
      baseStyle: {
        transition: "all 0.15s ease",
        fontWeight: "semibold",
        borderRadius: "lg",
      },
      defaultProps: {
        colorScheme: "green",
      },
      variants: {
        solid: {
          bg: "accent",
          color: "accent.contrast",
          _hover: {
            bg: "accent.hover",
            transform: "translateY(-1px)",
            _disabled: { bg: "accent", transform: "none" },
          },
          _active: { bg: "accent.active", transform: "translateY(0)" },
        },
        ghost: {
          _hover: { bg: "whiteAlpha.100" },
        },
        outline: {
          borderColor: "border.strong",
          _hover: { bg: "whiteAlpha.100", borderColor: "accent.fg" },
        },
      },
    },
    IconButton: {
      baseStyle: {
        borderRadius: "lg",
        transition: "all 0.15s ease",
      },
    },
    Table: {
      baseStyle: {
        th: {
          textTransform: "uppercase",
          fontSize: "xs",
          fontWeight: "bold",
          letterSpacing: "wider",
          color: "text.muted",
        },
        td: {
          fontSize: "sm",
        },
      },
    },
    Heading: {
      baseStyle: {
        fontWeight: "600",
        letterSpacing: "-0.02em",
      },
    },
    Modal: {
      baseStyle: {
        overlay: {
          bg: "blackAlpha.600",
          backdropFilter: "blur(24px)",
        },
        dialog: {
          mx: { base: 4, md: 0 },
          bgColor: "surface.card",
          borderRadius: "2xl",
          border: "1px solid",
          borderColor: "border.subtle",
        },
        body: {
          display: "flex",
          flexDirection: "column",
        },
      },
    },
  },
  semanticTokens: {
    colors: {
      // Surfaces
      surface: { default: "bg.200" },
      "surface.card": { default: "bg.100" },
      "surface.elevated": { default: "bg.50" },
      "surface.inset": { default: "bg.400" },
      "surface.bar": { default: "bg.400" },
      // Borders
      "border.subtle": { default: "whiteAlpha.100" },
      "border.default": { default: "whiteAlpha.200" },
      "border.strong": { default: "whiteAlpha.300" },
      // Text
      "text.primary": { default: "gray.100" },
      "text.secondary": { default: "gray.300" },
      "text.muted": { default: "gray.500" },
      // Accent (primary brand/action)
      accent: { default: "accent.400" },
      "accent.fg": { default: "accent.200" },
      "accent.hover": { default: "accent.300" },
      "accent.active": { default: "accent.500" },
      "accent.contrast": { default: "gray.900" },
      // Status
      positive: { default: "accent.300" },
      "positive.fg": { default: "accent.200" },
      negative: { default: "red.400" },
      "negative.fg": { default: "red.300" },
      warning: { default: "#dd9b4e" },
      "warning.fg": { default: "#e8bd86" },
      info: { default: "lightBlue.300" },
      "info.fg": { default: "lightBlue.200" },
    },
  },
  colors: {
    gray: {
      50: "#F7F7F7",
      100: "#EDEDED",
      200: "#E2E2E2",
      300: "#CBCBCB",
      400: "#A0A0A0",
      500: "#717171",
      600: "#4A4A4A",
      700: "#2D2D2D",
      800: "#1A1A1A",
      900: "#171717",
    },
    // Calmer, restrained teal-green accent — replaces the neon lime (#76ff03)
    // as the primary brand/action color for the "calm modern dashboard" look.
    accent: {
      50: "#e6f7f1",
      100: "#c2ebdd",
      200: "#8fd9c1",
      300: "#5ec5a6",
      400: "#3fae8f",
      500: "#2f9479",
      600: "#247c66",
      700: "#1d6353",
      800: "#164b40",
      900: "#0f342d",
    },
    lightBlue: {
      50: "#e1f5fe", 100: "#b3e5fc", 200: "#81d4fa",
      300: "#4fc3f7", 400: "#29b6f6", 500: "#03a9f4",
      600: "#039be5", 700: "#0288d1", 800: "#0277bd",
      900: "#01579b", A100: "#80d8ff", A200: "#40c4ff",
      A400: "#00b0ff", A700: "#0091ea",
    },
    // Retained for the Logo "spark" and any not-yet-migrated references.
    lightGreen: {
      50: "#f1f8e9", 100: "#dcedc8", 200: "#c5e1a5",
      300: "#aed581", 400: "#9ccc65", 500: "#8bc34a",
      600: "#7cb342", 700: "#689f38", 800: "#558b2f",
      900: "#33691e", A100: "#ccff90", A200: "#b2ff59",
      A400: "#76ff03", A700: "#64dd17",
    },
    red: {
      50: "#ffebee", 100: "#ffcdd2", 200: "#ef9a9a",
      300: "#e57373", 400: "#ef5350", 500: "#f44336",
      600: "#e53935", 700: "#d32f2f", 800: "#c62828",
      900: "#b71c1c", A100: "#ff8a80", A200: "#ff5252",
      A400: "#ff1744", A700: "#d50000",
    },
    bg: {
      50: "#2b2b33",
      100: "#26262d",
      200: "#1f1f25",
      300: "#1a1a20",
      400: "#141418",
    },
  },
});
