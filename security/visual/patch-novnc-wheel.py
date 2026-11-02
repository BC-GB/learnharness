"""Preserve large wheel deltas and fractional remainders in distro noVNC.

The installed noVNC emits at most one VNC notch for each DOM wheel event,
then discards the rest. Apply only to that exact implementation; fail a build
if upstream changes it so a new version gets reviewed rather than repatched.
"""
from pathlib import Path
import sys

target = Path(sys.argv[1])
text = target.read_text()
for axis in ('X', 'Y'):
    variable = 'this._accumulatedWheelDelta' + axis
    before = f'if (Math.abs({variable}) >= WHEEL_STEP) {{'
    after = (f'{variable} = Math.max(-20 * WHEEL_STEP, Math.min(20 * WHEEL_STEP, {variable}));\n'
             f'        while (Math.abs({variable}) >= WHEEL_STEP) {{')
    # Constructor also initializes this field; replace only the wheel handler.
    start = text.index('    _handleWheel(')
    end = text.index('    _fakeMouseMove(', start)
    handler = text[start:end]
    reset = f'{variable} = 0;'
    if handler.count(before) != 1 or handler.count(reset) != 1:
        raise RuntimeError('Unrecognized noVNC wheel implementation; review required')
    handler = handler.replace(before, after).replace(reset, f'{variable} -= Math.sign({variable}) * WHEEL_STEP;')
    text = text[:start] + handler + text[end:]
target.write_text(text)
