// M1 exit test set: each paraphrase must resolve to the same Spec as its README prompt does through the regex parser.
export const paraphrases = {
  'twisted vase 120 tall, 70 wide, 2mm walls, 12 ribs': [
    'a vase, 12 cm high and 7 cm across, twisted, with 12 ribs and 2 mm walls',
    'make me a twisted vase: height 120mm, diameter 70mm, wall thickness 2mm, 12 ribs',
    'I want a vase that is 70 mm wide and 120 mm tall with a twist, twelve ribs and walls 2mm thick',
    'vase, twisted, ribbed with 12 ribs, 120mm tall by 70mm wide, 2 millimetre walls',
    'Could you design a 120 mm tall vase, 70 mm in diameter, twisted, 12 ribs, 2 mm thick walls?',
    'twisty vase 12cm tall 7cm wide, walls 2mm, 12 ribs',
    'create a twisted flower vase with 12 ribs; 70 wide, 120 high, 2mm wall',
  ],
  'gear with 24 teeth, 50mm diameter, 6mm thick, 5mm hole': [
    'a 24-tooth gear, 50 mm across, 6 mm thick, with a 5 mm hole',
    'cog with twenty-four teeth, diameter 5 cm, thickness 6mm, 5mm bore',
    'make a gear: 50mm diameter, 24 teeth, 6mm thick, 5mm shaft hole',
    'I need a gear that is 6 mm thick and 50 mm wide with 24 teeth and a 5 mm center hole',
    'spur gear, 24 teeth, Ø50, 6mm thick, 5mm hole in the middle',
    'gear 50mm diameter 6mm thickness 24 teeth with a 5 mm hole',
    'design a cog: 24 teeth, 50 millimetres in diameter, 6 mm thick, hole of 5 mm',
  ],
  'box 80 x 50 x 30 with 2mm walls and 6mm corners': [
    'a box 80 wide, 50 deep and 30 tall, 2mm walls, 6mm rounded corners',
    'container measuring 80 by 50 by 30 mm with 2 mm walls and 6 mm corner radius',
    'make a box: width 80mm, depth 50mm, height 30mm, walls 2mm, corners 6mm',
    'I want an 8 x 5 x 3 cm box with 2mm thick walls and 6mm corners',
    'tray 80x50x30mm, wall thickness 2 mm, 6 mm corners',
    'Could you make a box that is 80mm long, 50mm deep and 30mm high with 2mm walls and 6mm rounded corners?',
    'box, 80 by 50, 30 high, 2 mm walls, corner radius 6 mm',
  ],
} satisfies Record<string, Array<string>>;
