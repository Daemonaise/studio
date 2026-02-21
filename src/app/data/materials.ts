
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
    id: "PLA",
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
    id: "PETG",
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
    id: "ABS",
    name: "ABS",
    description: "Tough and impact-resistant material with good temperature resistance. Commonly used for functional parts.",
    imageId: "material-abs",
    properties: [
      { name: "Tensile Strength", value: "40", unit: "MPa" },
      { name: "Max Temperature", value: "100", unit: "°C" },
      { name: "Durability", value: "High", unit: "" },
    ],
    useCases: ["Interior panels", "Brackets", "Enclosures"],
  },
    {
    id: "TPU",
    name: "TPU",
    description: "Flexible, rubber-like material. Excellent for parts requiring impact absorption and vibration damping.",
    imageId: "material-tpu",
    properties: [
      { name: "Tensile Strength", value: "30", unit: "MPa" },
      { name: "Max Temperature", value: "80", unit: "°C" },
      { name: "Durability", value: "Very High", unit: "" },
    ],
    useCases: ["Gaskets", "Seals", "Bushings", "Phone mounts"],
  },
  {
    id: "ASA",
    name: "ASA",
    description: "Excellent UV and weather resistance, making it ideal for exterior parts. Similar properties to ABS but with better outdoor durability.",
    imageId: "material-asa",
    properties: [
      { name: "Tensile Strength", value: "45", unit: "MPa" },
      { name: "Max Temperature", value: "95", unit: "°C" },
      { name: "Durability", value: "High", unit: "" },
    ],
    useCases: ["Grilles", "Mirror housings", "Bumper trim", "Exterior panels"],
  },
  {
    id: "NYLON",
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
    id: "PLA_CF",
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
    id: "NYLON_CF",
    name: "Nylon-CF",
    description: "A top-tier material combining the toughness of Nylon with the stiffness of carbon fiber. Excellent for high-performance, end-use parts.",
    imageId: "material-nylon-cf",
    properties: [
      { name: "Tensile Strength", value: "110", unit: "MPa" },
      { name: "Max Temperature", value: "160", unit: "°C" },
      { name: "Durability", value: "Very High", unit: "" },
    ],
    useCases: ["Suspension components", "Engine brackets", "Aero parts", "Structural monocoque segments"],
  }
];
