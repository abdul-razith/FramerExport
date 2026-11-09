import type { MotionSpec, Node } from '../model.js';

/** Sets `node.motion` from Framer markers and captured start states (mutates and returns the tree). */
export function attachMotion(root: Node): Node {
  const visit = (node: Node) => {
    if (node.framerName === 'Smooth Scroll') node.motion = { kind: 'smooth-scroll' };
    else if (node.framerName === 'Loader') node.motion = { kind: 'loader' };
    else if (node.attrs['data-framer-cursor'] !== undefined) node.motion = { kind: 'cursor' };
    else if (node.animation) node.motion = { kind: node.animation.kind, from: node.animation.from };
    node.children.forEach(visit);
  };
  visit(root);
  return root;
}

export function motionUsage(root: Node): Set<MotionSpec['kind']> {
  const used = new Set<MotionSpec['kind']>();
  const visit = (node: Node) => {
    if (node.motion) used.add(node.motion.kind);
    node.children.forEach(visit);
  };
  visit(root);
  return used;
}
