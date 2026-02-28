
export type MaterialProperty = {
  name: string;
  value: string;
  unit: string;
};

export type MaterialCategory = "Standard" | "Engineering" | "Flexible" | "Composite";

export type Material = {
  id: string;
  name: string;
  description: string;
  imageId: string;
  category: MaterialCategory;
  properties: MaterialProperty[];
  useCases: string[];
};

export const materials: Material[] = [
  {
    id: "PLA",
    name: "PLA",
    category: "Standard",
    description: "The most widely used FDM material. Easy to print, dimensionally accurate, and available in hundreds of colors. Ideal for detailed prototypes and display models.",
    imageId: "material-pla",
    properties: [
      { name: "Tensile Strength", value: "7,252", unit: "PSI" },
      { name: "Max Temperature", value: "140", unit: "°F" },
      { name: "Durability", value: "Medium", unit: "" },
    ],
    useCases: ["Prototypes", "Display models", "Interior mockups", "Educational parts", "Consumer goods"],
  },
  {
    id: "PETG",
    name: "PETG",
    category: "Standard",
    description: "A versatile all-rounder with better temperature and chemical resistance than PLA. Excellent for functional prototypes and semi-structural parts.",
    imageId: "material-petg",
    properties: [
      { name: "Tensile Strength", value: "7,252", unit: "PSI" },
      { name: "Max Temperature", value: "176", unit: "°F" },
      { name: "Durability", value: "High", unit: "" },
    ],
    useCases: ["Functional prototypes", "Enclosures", "Food-safe containers", "Medical housings", "Brackets"],
  },
  {
    id: "ABS",
    name: "ABS",
    category: "Engineering",
    description: "Tough, impact-resistant, and machinable. A staple engineering material used across consumer electronics, automotive, and industrial applications.",
    imageId: "material-abs",
    properties: [
      { name: "Tensile Strength", value: "5,802", unit: "PSI" },
      { name: "Max Temperature", value: "212", unit: "°F" },
      { name: "Durability", value: "High", unit: "" },
    ],
    useCases: ["Electronic enclosures", "Interior panels", "Jigs & fixtures", "Mechanical parts", "Housings"],
  },
  {
    id: "ASA",
    name: "ASA",
    category: "Engineering",
    description: "Excellent UV and weather resistance — the go-to choice for outdoor or sun-exposed parts. Mechanically similar to ABS but far more durable outdoors.",
    imageId: "material-asa",
    properties: [
      { name: "Tensile Strength", value: "6,527", unit: "PSI" },
      { name: "Max Temperature", value: "203", unit: "°F" },
      { name: "Durability", value: "High", unit: "" },
    ],
    useCases: ["Outdoor fixtures", "Exterior automotive", "Signage", "Grilles", "Mirror housings"],
  },
  {
    id: "NYLON",
    name: "Nylon (PA)",
    category: "Engineering",
    description: "Exceptional strength, toughness, and chemical resistance against oils and fuels. The material of choice for high-wear mechanical and structural components.",
    imageId: "material-nylon",
    properties: [
      { name: "Tensile Strength", value: "10,153", unit: "PSI" },
      { name: "Max Temperature", value: "302", unit: "°F" },
      { name: "Durability", value: "Very High", unit: "" },
    ],
    useCases: ["Gears", "Bushings", "Intake components", "Structural brackets", "Fuel line clips"],
  },
  {
    id: "TPU",
    name: "TPU",
    category: "Flexible",
    description: "A rubber-like flexible material with outstanding impact absorption and tear resistance. Perfect for anything that needs to flex, grip, or dampen vibration.",
    imageId: "material-tpu",
    properties: [
      { name: "Tensile Strength", value: "4,351", unit: "PSI" },
      { name: "Max Temperature", value: "176", unit: "°F" },
      { name: "Durability", value: "Very High", unit: "" },
    ],
    useCases: ["Gaskets & seals", "Grips & handles", "Wearables", "Impact protection", "Flexible hinges"],
  },
  {
    id: "PLA_CF",
    name: "PLA-CF",
    category: "Composite",
    description: "Carbon fiber reinforced PLA. Significantly stiffer than standard PLA with a premium matte finish — great for lightweight structural mockups and aesthetic parts.",
    imageId: "material-pla-cf",
    properties: [
      { name: "Tensile Strength", value: "9,427", unit: "PSI" },
      { name: "Max Temperature", value: "149", unit: "°F" },
      { name: "Durability", value: "Medium", unit: "" },
    ],
    useCases: ["Stiff structural mockups", "Drone frames", "Lightweight brackets", "Aesthetic interior parts"],
  },
  {
    id: "NYLON_CF",
    name: "Nylon-CF",
    category: "Composite",
    description: "Top-tier performance combining Nylon's toughness with carbon fiber's rigidity. Used for high-load, end-use parts where weight and strength are critical.",
    imageId: "material-nylon-cf",
    properties: [
      { name: "Tensile Strength", value: "15,954", unit: "PSI" },
      { name: "Max Temperature", value: "320", unit: "°F" },
      { name: "Durability", value: "Very High", unit: "" },
    ],
    useCases: ["Suspension components", "Aerospace brackets", "Aero parts", "Industrial tooling", "Structural monocoque"],
  }
];
