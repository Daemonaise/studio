
export type MaterialProperty = {
  name: string;
  value: string;
  unit: string;
};

export type Material = {
  id: string;
  name: string;
  description: string;
  imageId: string;
  properties: MaterialProperty[];
  useCases: string[];
};

export const materials: Material[] = [
  {
    id: "pla",
    name: "PLA",
    description: "Good for detailed mockups and non-structural interior trim. Easy to print but has a low heat deflection temperature.",
    imageId: "material-pla",
    properties: [
      { name: "Tensile Strength", value: "50", unit: "MPa" },
      { name: "Max Temperature", value: "60", unit: "°C" },
      { name: "Durability", value: "Medium", unit: "" },
    ],
    useCases: ["Interior trim mockups", "Dash knobs", "Display models"],
  },
  {
    id: "petg",
    name: "PETG",
    description: "A good all-rounder with better temperature and chemical resistance than PLA. Suitable for functional prototypes and some end-use parts.",
    imageId: "material-petg",
    properties: [
      { name: "Tensile Strength", value: "50", unit: "MPa" },
      { name: "Max Temperature", value: "80", unit: "°C" },
      { name: "Durability", value: "High", unit: "" },
    ],
    useCases: ["Brackets", "Engine bay covers (non-critical)", "Functional prototypes"],
  },
  {
    id: "asa",
    name: "ASA",
    description: "Excellent UV and weather resistance, making it ideal for exterior parts. Similar properties to ABS but with better outdoor durability.",
    imageId: "material-abs", // Reusing for now
    properties: [
      { name: "Tensile Strength", value: "45", unit: "MPa" },
      { name: "Max Temperature", value: "95", unit: "°C" },
      { name: "Durability", value: "High", unit: "" },
    ],
    useCases: ["Grilles", "Mirror housings", "Bumper trim", "Exterior panels"],
  },
  {
    id: "nylon",
    name: "Nylon (PA)",
    description: "Exceptional strength, toughness, and chemical resistance, especially oils and fuels. Great for high-wear mechanical parts.",
    imageId: "material-nylon",
    properties: [
      { name: "Tensile Strength", value: "70", unit: "MPa" },
      { name: "Max Temperature", value: "150", unit: "°C" },
      { name: "Durability", value: "Very High", unit: "" },
    ],
    useCases: ["Gears", "Bushings", "Intake components", "Fuel line clips"],
  },
  {
    id: "pla-cf",
    name: "PLA-CF",
    description: "Carbon fiber reinforced PLA. Offers increased stiffness and a matte finish, but still has low temperature resistance.",
    imageId: "material-pla",
    properties: [
      { name: "Tensile Strength", value: "65", unit: "MPa" },
      { name: "Max Temperature", value: "65", unit: "°C" },
      { name: "Durability", value: "Medium", unit: "" },
    ],
    useCases: ["Stiff structural mockups", "Aesthetic interior parts"],
  },
  {
    id: "petg-cf",
    name: "PETG-CF",
    description: "Carbon fiber reinforcement adds significant stiffness and strength to PETG, making it suitable for more demanding applications.",
    imageId: "material-petg",
    properties: [
      { name: "Tensile Strength", value: "80", unit: "MPa" },
      { name: "Max Temperature", value: "85", unit: "°C" },
      { name: "Durability", value: "High", unit: "" },
    ],
    useCases: ["Chassis brackets", "Fan shrouds", "Durable jigs and fixtures"],
  },
  {
    id: "nylon-cf",
    name: "Nylon-CF",
    description: "A top-tier material combining the toughness of Nylon with the stiffness of carbon fiber. Excellent for high-performance, end-use parts.",
    imageId: "material-nylon",
    properties: [
      { name: "Tensile Strength", value: "110", unit: "MPa" },
      { name: "Max Temperature", value: "160", unit: "°C" },
      { name: "Durability", value: "Very High", unit: "" },
    ],
    useCases: ["Suspension components", "Engine brackets", "Aero parts", "Structural monocoque segments"],
  },
   {
    id: "asa-cf",
    name: "ASA-CF",
    description: "Combines the UV resistance of ASA with the stiffness of carbon fiber. Perfect for lightweight, strong, and durable exterior components.",
    imageId: "material-abs",
    properties: [
      { name: "Tensile Strength", value: "75", unit: "MPa" },
      { name: "Max Temperature", value: "100", unit: "°C" },
      { name: "Durability": "Very High", unit: "" },
    ],
    useCases: ["Spoilers", "Splitters", "Side skirts", "Custom body panels"],
  },
];
