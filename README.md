# Flexure Sim

Interactive 2D flexure mechanics demonstrator that runs entirely in the browser.

## v1 examples

- Resonating cantilever beam
- Crossed-beam flexure hinge (the crossing is geometrical; the leaves are not connected at the intersection)
- Parallelogram flexure stage

## Solver

The app is not a shape-morphing animation. Geometry is discretized into two-node planar Euler–Bernoulli frame elements with three DOFs per node (`u`, `v`, `theta`). Static equilibrium uses a corotational element energy formulation with load stepping and Newton iterations, allowing large overall translations/rotations while retaining the small-strain beam assumption. Tangent stiffness is obtained by differentiating each element's conservative internal-force vector.

Modal analysis linearizes about the undeformed geometry, assembles the conventional frame stiffness and consistent mass matrices, and uses generalized inverse iteration to extract the first eigenpair.

For the cantilever example, the UI continuously compares FEM tip displacement and first natural frequency against the closed-form Euler–Bernoulli cantilever results.

### v1 modeling scope

- 2D in-plane mechanics
- linear-elastic isotropic material
- slender Euler–Bernoulli leaves (no shear deformation)
- no contact, friction, plasticity, fracture, fillet stress concentration or out-of-plane effects
- crossed-beam leaves may geometrically intersect without a joint; their real-world out-of-plane separation is not modeled
- stage members are deliberately much thicker than the leaves, but remain finite-stiffness elastic members rather than mathematical rigid links
- modal animation is visually slowed; the reported eigenfrequency is physical

## Run locally

No build step or package install is required. Because the JavaScript uses ES modules, serve the folder over HTTP, for example:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000`.

## GitHub Pages

The project is static and can be served directly from the repository root with GitHub Pages.

## Next technical steps

Good directions for v2 are Timoshenko elements for thick flexures, geometric/stress concentration models for notched flexures, true rigid-body multi-point constraints, multiple eigenmodes, harmonic response with damping, user-drawn geometry, mesh convergence tooling, and exportable result data.
