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
    id: "abs",
    name: "ABS (Acrylonitrile Butadiene Styrene)",
    description: "A tough, impact-resistant thermoplastic ideal for functional prototypes and end-use parts.",
    imageId: "material-abs",
    properties: [
      { name: "Tensile Strength", value: "40", unit: "MPa" },
      { name: "Stiffness (Young's Modulus)", value: "2.0", unit: "GPa" },
      { name: "Max Temperature", value: "100", unit: "°C" },
      { name: "Durability", value: "High", unit: "" },
    ],
    useCases: ["Automotive components", "Electronic housings", "Toys", "Protective cases"],
  },
  {
    id: "pla",
    name: "PLA (Polylactic Acid)",
    description: "A biodegradable and easy-to-print material, perfect for rapid prototyping and detailed models.",
    imageId: "material-pla",
    properties: [
      { name: "Tensile Strength", value: "50", unit: "MPa" },
      { name: "Stiffness (Young's Modulus)", value: "3.5", unit: "GPa" },
      { name: "Max Temperature", value: "60", unit: "°C" },
      { name: "Durability", value: "Medium", unit: "" },
    ],
    useCases: ["Visual prototypes", "Architectural models", "Low-stress applications", "Educational models"],
  },
  {
    id: "petg",
    name: "PETG (Polyethylene Terephthalate Glycol)",
    description: "Combines the ease of printing of PLA with the strength and durability of ABS.",
    imageId: "material-petg",
    properties: [
      { name: "Tensile Strength", value: "50", unit: "MPa" },
      { name: "Stiffness (Young's Modulus)", value: "2.1", unit: "GPa" },
      { name: "Max Temperature", value: "80", unit: "°C" },
      { name: "Durability", value: "High", unit: "" },
    ],
    useCases: ["Mechanical parts", "Food-safe containers", "Water bottles", "Signage"],
  },
  {
    id: "nylon",
    name: "Nylon (Polyamide)",
    description: "Known for its exceptional strength, flexibility, and durability. Excellent for living hinges and high-wear parts.",
    imageId: "material-nylon",
    properties: [
      { name: "Tensile Strength", value: "70", unit: "MPa" },
      { name: "Stiffness (Young's Modulus)", value: "1.4", unit: "GPa" },
      { name: "Max Temperature", value: "150", unit: "°C" },
      { name: "Durability", value: "Very High", unit: "" },
    ],
    useCases: ["Gears and bearings", "Living hinges", "Tools and fixtures", "Drone parts"],
  },
  {
    id: "tpu",
    name: "TPU (Thermoplastic Polyurethane)",
    description: "A flexible, rubber-like material that is highly resistant to abrasion, oil, and grease.",
    imageId: "material-tpu",
    properties: [
      { name: "Tensile Strength", value: "30", unit: "MPa" },
      { name: "Stiffness (Young's Modulus)", value: "0.05", unit: "GPa" },
      { name: "Max Temperature", value: "80", unit: "°C" },
      { name: "Durability", value: "Very High", unit: "" },
    ],
    useCases: ["Phone cases", "Flexible prototypes", "Seals and gaskets", "Wearables"],
  },
  {
    id: "standard-resin",
    name: "Standard Resin",
    description: "Delivers highly detailed and smooth surface finishes, ideal for intricate models and visual prototypes.",
    imageId: "material-resin",
    properties: [
      { name: "Tensile Strength", value: "60", unit: "MPa" },
      { name: "Stiffness (Young's Modulus)", value: "2.8", unit: "GPa" },
      { name: "Max Temperature", value: "70", unit: "°C" },
      { name: "Durability", value: "Low", unit: "" },
    ],
    useCases: ["Miniatures and figurines", "Jewelry prototyping", "Dental models", "High-detail visual models"],
  },
];
