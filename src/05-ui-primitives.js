/* ==== 05-ui-primitives ==== */
/* ============================================================================
   UI PRIMITIVES
   ========================================================================== */
const {
  useState,
  useMemo,
  useEffect,
  useRef,
  Fragment
} = React;

/* ---- Inline SVG icon set (no external icon dependency) ---- */
function Icon({
  d,
  size,
  style,
  fill
}) {
  return /*#__PURE__*/React.createElement("svg", {
    width: size || 15,
    height: size || 15,
    viewBox: "0 0 24 24",
    fill: fill || "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    style: {
      flexShrink: 0,
      ...(style || {})
    },
    "aria-hidden": "true"
  }, d);
}
const I = {
  grid: /*#__PURE__*/React.createElement(Icon, {
    d: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("rect", {
      x: "3",
      y: "3",
      width: "7",
      height: "7"
    }), /*#__PURE__*/React.createElement("rect", {
      x: "14",
      y: "3",
      width: "7",
      height: "7"
    }), /*#__PURE__*/React.createElement("rect", {
      x: "14",
      y: "14",
      width: "7",
      height: "7"
    }), /*#__PURE__*/React.createElement("rect", {
      x: "3",
      y: "14",
      width: "7",
      height: "7"
    }))
  }),
  layers: /*#__PURE__*/React.createElement(Icon, {
    d: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M12 2 2 7l10 5 10-5-10-5Z"
    }), /*#__PURE__*/React.createElement("path", {
      d: "m2 17 10 5 10-5"
    }), /*#__PURE__*/React.createElement("path", {
      d: "m2 12 10 5 10-5"
    }))
  }),
  briefcase: /*#__PURE__*/React.createElement(Icon, {
    d: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("rect", {
      x: "2",
      y: "7",
      width: "20",
      height: "14",
      rx: "2"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"
    }))
  }),
  gauge: /*#__PURE__*/React.createElement(Icon, {
    d: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "m12 14 4-4"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M3.34 19a10 10 0 1 1 17.32 0"
    }))
  }),
  scale: /*#__PURE__*/React.createElement(Icon, {
    d: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"
    }), /*#__PURE__*/React.createElement("path", {
      d: "m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M7 21h10"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M12 3v18"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"
    }))
  }),
  heart: /*#__PURE__*/React.createElement(Icon, {
    d: /*#__PURE__*/React.createElement("path", {
      d: "M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"
    })
  }),
  book: /*#__PURE__*/React.createElement(Icon, {
    d: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20"
    }))
  }),
  library: /*#__PURE__*/React.createElement(Icon, {
    d: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "m16 6 4 14"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M12 6v14"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M8 8v12"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M4 4v16"
    }))
  }),
  file: /*#__PURE__*/React.createElement(Icon, {
    d: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M14 2v5h6"
    }))
  }),
  plus: /*#__PURE__*/React.createElement(Icon, {
    d: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M5 12h14"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M12 5v14"
    }))
  }),
  copy: /*#__PURE__*/React.createElement(Icon, {
    d: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("rect", {
      x: "9",
      y: "9",
      width: "13",
      height: "13",
      rx: "2"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"
    }))
  }),
  trash: /*#__PURE__*/React.createElement(Icon, {
    d: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M3 6h18"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
    }))
  }),
  chevD: /*#__PURE__*/React.createElement(Icon, {
    d: /*#__PURE__*/React.createElement("path", {
      d: "m6 9 6 6 6-6"
    }),
    size: 14
  }),
  chevR: /*#__PURE__*/React.createElement(Icon, {
    d: /*#__PURE__*/React.createElement("path", {
      d: "m9 18 6-6-6-6"
    }),
    size: 14
  }),
  award: /*#__PURE__*/React.createElement(Icon, {
    d: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("circle", {
      cx: "12",
      cy: "8",
      r: "6"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M15.477 12.89 17 22l-5-3-5 3 1.523-9.11"
    })),
    size: 12
  }),
  alert: /*#__PURE__*/React.createElement(Icon, {
    d: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M12 9v4"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M12 17h.01"
    })),
    size: 13
  }),
  check: /*#__PURE__*/React.createElement(Icon, {
    d: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("circle", {
      cx: "12",
      cy: "12",
      r: "10"
    }), /*#__PURE__*/React.createElement("path", {
      d: "m9 12 2 2 4-4"
    })),
    size: 13
  }),
  bulb: /*#__PURE__*/React.createElement(Icon, {
    d: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M9 18h6"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M10 22h4"
    })),
    size: 12
  }),
  print: /*#__PURE__*/React.createElement(Icon, {
    d: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M6 9V2h12v7"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"
    }), /*#__PURE__*/React.createElement("rect", {
      x: "6",
      y: "14",
      width: "12",
      height: "8"
    })),
    size: 14
  }),
  download: /*#__PURE__*/React.createElement(Icon, {
    d: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M7 10l5 5 5-5"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M12 15V3"
    })),
    size: 14
  }),
  reset: /*#__PURE__*/React.createElement(Icon, {
    d: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M3 3v5h5"
    })),
    size: 14
  }),
  x: /*#__PURE__*/React.createElement(Icon, {
    d: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M18 6 6 18"
    }), /*#__PURE__*/React.createElement("path", {
      d: "m6 6 12 12"
    })),
    size: 17
  }),
  clock: /*#__PURE__*/React.createElement(Icon, {
    d: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("circle", {
      cx: "12",
      cy: "12",
      r: "10"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M12 6v6l4 2"
    }))
  }),
  table: /*#__PURE__*/React.createElement(Icon, {
    d: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("rect", {
      x: "3",
      y: "3",
      width: "18",
      height: "18",
      rx: "2"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M3 9h18"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M3 15h18"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M9 3v18"
    }))
  }),
  calc: /*#__PURE__*/React.createElement(Icon, {
    d: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("rect", {
      x: "4",
      y: "2",
      width: "16",
      height: "20",
      rx: "2"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M8 6h8"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M8 11h.01M12 11h.01M16 11h.01M8 15h.01M12 15h.01M16 15h.01M8 19h8"
    })),
    size: 16
  }),
  note: /*#__PURE__*/React.createElement(Icon, {
    d: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M14 2v5h6"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M8 13h8M8 17h5"
    })),
    size: 16
  }),
  info: /*#__PURE__*/React.createElement(Icon, {
    d: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("circle", {
      cx: "12",
      cy: "12",
      r: "10"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M12 16v-4"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M12 8h.01"
    })),
    size: 13
  })
};

/* ---- Number input that keeps the caret stable while typing ---- */
function Money({
  value,
  onChange,
  className,
  placeholder,
  disabled
}) {
  const formatVal = v => {
    if (v === 0 || v === "0" || v === "" || v == null) return "";
    const str = v.toString();
    const parts = str.split(".");
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return parts.join(".");
  };

  const [localValue, setLocalValue] = React.useState(formatVal(value));

  React.useEffect(() => {
    setLocalValue(formatVal(value));
  }, [value]);

  const handleChange = e => {
    const el = e.target;
    const caret = el.selectionStart;
    const oldVal = el.value;
    
    const raw = oldVal.replace(/[^0-9.\-]/g, "");
    const formatted = formatVal(raw);
    
    const digitsBeforeCaret = oldVal.substring(0, caret).replace(/[^0-9.\-]/g, "").length;
    
    let newCaret = 0;
    let digitsSeen = 0;
    for (let i = 0; i < formatted.length; i++) {
      if (digitsSeen === digitsBeforeCaret) {
        newCaret = i;
        break;
      }
      if (/[0-9.\-]/.test(formatted[i])) {
        digitsSeen++;
      }
    }
    if (digitsSeen === digitsBeforeCaret) newCaret = formatted.length;
    
    setLocalValue(formatted);
    onChange(raw === "" ? 0 : raw);
    
    window.requestAnimationFrame(() => {
      if (el && document.activeElement === el) {
        el.setSelectionRange(newCaret, newCaret);
      }
    });
  };

  return /*#__PURE__*/React.createElement("input", {
    className: "tp-money " + (className || ""),
    type: "text",
    inputMode: "decimal",
    disabled: disabled,
    value: localValue,
    placeholder: placeholder || "0",
    onFocus: e => {
      window.__tpLastMoneyInput = e.target;
    },
    onChange: handleChange
  });
}
function Field({
  label,
  hint,
  value,
  onChange,
  disabled
}) {
  return /*#__PURE__*/React.createElement("label", {
    className: "tp-field"
  }, /*#__PURE__*/React.createElement("span", null, label, hint && /*#__PURE__*/React.createElement("em", null, hint)), /*#__PURE__*/React.createElement(Money, {
    value: value,
    onChange: onChange,
    disabled: disabled
  }));
}
function Seg({
  value,
  onChange,
  options,
  small
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "tp-seg" + (small ? " sm" : "")
  }, options.map(o => /*#__PURE__*/React.createElement("button", {
    key: o.v,
    className: value === o.v ? "on" : "",
    onClick: () => onChange(o.v),
    type: "button"
  }, o.l)));
}
function Card({
  title,
  sub,
  children,
  right,
  flush
}) {
  return /*#__PURE__*/React.createElement("section", {
    className: "tp-card"
  }, (title || right) && /*#__PURE__*/React.createElement("div", {
    className: "tp-card-head"
  }, title && /*#__PURE__*/React.createElement("h3", null, title), sub && /*#__PURE__*/React.createElement("span", {
    className: "tp-card-sub"
  }, sub), right && /*#__PURE__*/React.createElement("div", {
    className: "tp-card-right"
  }, right)), /*#__PURE__*/React.createElement("div", {
    className: flush ? "" : "tp-card-body"
  }, children));
}
function Note({
  children,
  kind
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "tp-note " + (kind || "")
  }, I.info, " ", /*#__PURE__*/React.createElement("div", null, children));
}
function StatusPill({
  status
}) {
  const map = {
    under: {
      l: "Under",
      c: "ok"
    },
    phaseout: {
      l: "In phase-out",
      c: "warn"
    },
    above: {
      l: "Above",
      c: "bad"
    }
  };
  const m = map[status] || map.under;
  return /*#__PURE__*/React.createElement("span", {
    className: "tp-pill " + m.c
  }, m.l);
}

/* ---- A phase-out position bar: shows where MAGI sits in the range ---- */
function RangeBar({
  value,
  lo,
  hi
}) {
  if (hi == null || !isFinite(hi)) {
    const over = value > lo;
    return /*#__PURE__*/React.createElement("div", {
      className: "tp-rangebar hard"
    }, /*#__PURE__*/React.createElement("div", {
      className: "tp-rb-fill " + (over ? "bad" : "ok"),
      style: {
        width: over ? "100%" : "50%"
      }
    }), /*#__PURE__*/React.createElement("span", {
      className: "tp-rb-lab"
    }, over ? "over limit" : "under limit"));
  }
  if (!isFinite(lo)) return /*#__PURE__*/React.createElement("div", {
    className: "tp-rangebar"
  }, /*#__PURE__*/React.createElement("span", {
    className: "tp-rb-lab"
  }, "no limit"));
  const span = hi - lo;
  const p = span > 0 ? Math.min(1, Math.max(0, (value - lo) / span)) : value > lo ? 1 : 0;
  const cls = value < lo ? "ok" : value >= hi ? "bad" : "warn";
  return /*#__PURE__*/React.createElement("div", {
    className: "tp-rangebar"
  }, /*#__PURE__*/React.createElement("div", {
    className: "tp-rb-fill " + cls,
    style: {
      width: (p * 100).toFixed(1) + "%"
    }
  }), /*#__PURE__*/React.createElement("div", {
    className: "tp-rb-mark",
    style: {
      left: (p * 100).toFixed(1) + "%"
    }
  }));
}

/* ---- Charts drawn as inline SVG, no chart library ---- */
function StackedBars({
  data,
  series,
  height,
  format,
  axisFormat
}) {
  const axisF = axisFormat || (v => "$" + Math.round(v / 1000) + "k");
  const h = height || 210,
    padL = 56,
    padB = 34,
    padT = 10,
    padR = 8;
  const w = 640;
  const max = Math.max(1, ...data.map(d => series.reduce((a, s) => a + Math.max(0, d[s.key] || 0), 0)));
  const iw = w - padL - padR,
    ih = h - padB - padT;
  const bw = Math.min(72, iw / Math.max(1, data.length) * 0.6);
  const ticks = 4;
  return /*#__PURE__*/React.createElement("svg", {
    viewBox: `0 0 ${w} ${h}`,
    className: "tp-svg",
    preserveAspectRatio: "xMidYMid meet",
    role: "img"
  }, Array.from({
    length: ticks + 1
  }).map((_, i) => {
    const v = max / ticks * i,
      y = padT + ih - v / max * ih;
    return /*#__PURE__*/React.createElement("g", {
      key: i
    }, /*#__PURE__*/React.createElement("line", {
      x1: padL,
      x2: w - padR,
      y1: y,
      y2: y,
      stroke: "#e8eaee",
      strokeDasharray: "2 4"
    }), /*#__PURE__*/React.createElement("text", {
      x: padL - 8,
      y: y + 4,
      textAnchor: "end",
      className: "tp-svg-axis"
    }, axisF(v)));
  }), data.map((d, i) => {
    const cx = padL + iw / data.length * (i + 0.5);
    let acc = 0;
    return /*#__PURE__*/React.createElement("g", {
      key: i
    }, series.map(s => {
      const v = Math.max(0, d[s.key] || 0);
      const bh = v / max * ih;
      const y = padT + ih - acc - bh;
      acc += bh;
      return v > 0 ? /*#__PURE__*/React.createElement("rect", {
        key: s.key,
        x: cx - bw / 2,
        y: y,
        width: bw,
        height: bh,
        fill: s.color
      }, /*#__PURE__*/React.createElement("title", null, s.label + ": " + format(v))) : null;
    }), /*#__PURE__*/React.createElement("title", null, d.name + (i === 0 ? " (base scenario)" : "") + " \u2014 total " + format(series.reduce((a, sr) => a + Math.max(0, d[sr.key] || 0), 0))), /*#__PURE__*/React.createElement("text", {
      x: cx,
      y: h - padB + 16,
      textAnchor: "middle",
      className: "tp-svg-lab"
    }, (() => {
      /* Numbered aliases keep long names distinguishable; the number survives
         truncation and the full name is on hover. The base scenario is marked. */
      const maxChars = Math.max(6, Math.floor(iw / data.length / 6.4));
      const alias = (i + 1) + ". " + d.name + (i === 0 ? " (base)" : "");
      return alias.length > maxChars ? alias.slice(0, maxChars - 1) + "\u2026" : alias;
    })()), /*#__PURE__*/React.createElement("text", {
      x: cx,
      y: h - padB + 28,
      textAnchor: "middle",
      className: "tp-svg-val"
    }, format(acc / ih * max)));
  }), /*#__PURE__*/React.createElement("line", {
    x1: padL,
    x2: w - padR,
    y1: padT + ih,
    y2: padT + ih,
    stroke: "#cfd4da"
  }));
}

/* ---- Marginal rate curve: total tax on the next dollar across an income sweep ---- */
function RateCurve({
  points,
  markerX,
  height
}) {
  const h = height || 200,
    padL = 46,
    padB = 30,
    padT = 12,
    padR = 12,
    w = 640;
  const iw = w - padL - padR,
    ih = h - padB - padT;
  const xs = points.map(p => p.x),
    ys = points.map(p => p.y);
  const xMin = Math.min(...xs),
    xMax = Math.max(...xs);
  const yMax = Math.max(0.45, Math.max(...ys) * 1.1);
  const X = x => padL + (x - xMin) / Math.max(1, xMax - xMin) * iw;
  const Y = y => padT + ih - y / yMax * ih;
  const path = points.map((p, i) => (i ? "L" : "M") + X(p.x).toFixed(1) + " " + Y(p.y).toFixed(1)).join(" ");
  return /*#__PURE__*/React.createElement("svg", {
    viewBox: `0 0 ${w} ${h}`,
    className: "tp-svg",
    preserveAspectRatio: "xMidYMid meet",
    role: "img"
  }, [0, 0.1, 0.2, 0.3, 0.4].filter(v => v <= yMax).map(v => /*#__PURE__*/React.createElement("g", {
    key: v
  }, /*#__PURE__*/React.createElement("line", {
    x1: padL,
    x2: w - padR,
    y1: Y(v),
    y2: Y(v),
    stroke: "#e8eaee",
    strokeDasharray: "2 4"
  }), /*#__PURE__*/React.createElement("text", {
    x: padL - 6,
    y: Y(v) + 4,
    textAnchor: "end",
    className: "tp-svg-axis"
  }, (v * 100).toFixed(0) + "%"))), /*#__PURE__*/React.createElement("path", {
    d: path,
    fill: "none",
    stroke: "#4338ca",
    strokeWidth: "2"
  }), markerX != null && markerX >= xMin && markerX <= xMax && /*#__PURE__*/React.createElement("g", null, /*#__PURE__*/React.createElement("line", {
    x1: X(markerX),
    x2: X(markerX),
    y1: padT,
    y2: padT + ih,
    stroke: "#dc2626",
    strokeWidth: "1.5",
    strokeDasharray: "3 3"
  }), /*#__PURE__*/React.createElement("text", {
    x: X(markerX),
    y: padT - 2,
    textAnchor: "middle",
    className: "tp-svg-val",
    fill: "#dc2626"
  }, "current")), points.filter((_, i) => i % Math.ceil(points.length / 6) === 0).map((p, i) => /*#__PURE__*/React.createElement("text", {
    key: i,
    x: X(p.x),
    y: h - padB + 16,
    textAnchor: "middle",
    className: "tp-svg-lab"
  }, "$" + Math.round(p.x / 1000) + "k")), /*#__PURE__*/React.createElement("line", {
    x1: padL,
    x2: w - padR,
    y1: padT + ih,
    y2: padT + ih,
    stroke: "#cfd4da"
  }));
}

/* ============================================================================
   D3 TAX LIABILITY COMPARISON BAR CHART
   Visualizes projected federal tax liability across saved tax scenarios using D3.
   ========================================================================== */
function D3TaxLiabilityComparisonChart({
  results,
  bestId,
  baseline,
  focusId,
  onSelectScenario,
  status,
  year
}) {
  const containerRef = useRef(null);
  const svgRef = useRef(null);
  const [dimensions, setDimensions] = useState({ width: 700, height: 260 });
  const [mode, setMode] = useState("total");
  const [sortBy, setSortBy] = useState("default");
  const [tooltip, setTooltip] = useState(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const updateSize = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        if (rect.width > 0) {
          setDimensions(d => ({ ...d, width: rect.width }));
        }
      }
    };
    updateSize();
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        if (entry.contentRect.width > 0) {
          setDimensions(d => ({ ...d, width: entry.contentRect.width }));
        }
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const bestResult = results.find(x => x.s.id === bestId) || results[0];
  const bestTax = bestResult ? bestResult.r.totalTax : 0;
  const baselineResult = baseline ? (results.find(x => x.s.id === baseline.id) || results[0]) : results[0];
  const baselineTax = baselineResult ? baselineResult.r.totalTax : 0;

  const data = useMemo(() => {
    const list = results.map(({ s, r }) => {
      const inc = Math.round(clamp0(r.fedIncomeTax - r.creditsApplied));
      const emp = Math.round(r.seTax + r.sCorpFICA + r.addlMedicare);
      const niit = Math.round(r.niit);
      return {
        id: s.id,
        name: s.name,
        totalTax: Math.round(r.totalTax),
        inc,
        emp,
        niit,
        effectiveRate: r.effectiveRate,
        taxableIncome: r.taxableIncome,
        isBest: s.id === bestId,
        isBaseline: baseline && s.id === baseline.id,
        isFocused: s.id === focusId,
        diffFromBest: Math.round(r.totalTax - bestTax),
        diffFromBaseline: Math.round(r.totalTax - baselineTax)
      };
    });

    if (sortBy === "lowest") {
      list.sort((a, b) => a.totalTax - b.totalTax);
    }
    return list;
  }, [results, bestId, baseline, focusId, bestTax, baselineTax, sortBy]);

  const maxTax = Math.max(...data.map(d => d.totalTax), 0);
  const minTax = Math.min(...data.map(d => d.totalTax), 0);
  const taxSpread = maxTax - minTax;
  const focusedItem = data.find(d => d.id === focusId) || data[0];

  useEffect(() => {
    if (!svgRef.current || !data.length) return;
    const d3 = window.d3 || (typeof d3 !== "undefined" ? d3 : null);
    if (!d3) return;

    const width = dimensions.width || 700;
    const height = 260;
    const margin = { top: 38, right: 28, bottom: 50, left: 68 };
    const innerWidth = Math.max(10, width - margin.left - margin.right);

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const xScale = d3.scaleBand()
      .domain(data.map(d => d.id))
      .range([margin.left, width - margin.right])
      .padding(0.28);

    const maxY = Math.max(1000, maxTax * 1.20);
    const yScale = d3.scaleLinear()
      .domain([0, maxY])
      .nice()
      .range([height - margin.bottom, margin.top]);

    const yAxisGrid = d3.axisLeft(yScale)
      .ticks(4)
      .tickSize(-innerWidth)
      .tickFormat("");

    svg.append("g")
      .attr("class", "tp-d3-grid")
      .attr("transform", `translate(${margin.left}, 0)`)
      .call(yAxisGrid)
      .selectAll("line")
      .attr("stroke", "#e2e8f0")
      .attr("stroke-dasharray", "2 4");

    const yAxis = d3.axisLeft(yScale)
      .ticks(4)
      .tickFormat(d => "$" + (d >= 1000 ? Math.round(d / 1000) + "k" : d));

    const yAxisGroup = svg.append("g")
      .attr("class", "tp-d3-axis")
      .attr("transform", `translate(${margin.left}, 0)`)
      .call(yAxis);

    yAxisGroup.select(".domain").attr("stroke", "#cbd5e1");
    yAxisGroup.selectAll(".tick line").attr("stroke", "#cbd5e1");
    yAxisGroup.selectAll(".tick text")
      .attr("fill", "var(--muted)")
      .attr("font-size", "11px");

    if (mode === "total") {
      const barsGroup = svg.append("g").attr("class", "tp-d3-bars");

      data.forEach(d => {
        const bandwidth = xScale.bandwidth();
        const barWidth = Math.min(84, bandwidth);
        const barX = xScale(d.id) + (bandwidth - barWidth) / 2;
        const barY = yScale(d.totalTax);
        const barHeight = Math.max(2, (height - margin.bottom) - barY);

        let fillColor = "#4f46e5";
        if (d.isBest) fillColor = "#059669";
        else if (d.isBaseline) fillColor = "#2563eb";

        const bar = barsGroup.append("rect")
          .attr("class", "tp-d3-bar")
          .attr("x", barX)
          .attr("y", barY)
          .attr("width", barWidth)
          .attr("height", barHeight)
          .attr("rx", Math.min(5, barWidth / 4))
          .attr("ry", Math.min(5, barWidth / 4))
          .attr("fill", fillColor)
          .attr("stroke", d.isFocused ? "var(--ink, #0f172a)" : (d.isBest ? "#047857" : "none"))
          .attr("stroke-width", d.isFocused ? 2.5 : (d.isBest ? 1.5 : 0))
          .attr("opacity", d.isFocused ? 1 : 0.9);

        bar.on("mouseenter", (event) => {
          bar.attr("opacity", 1).attr("filter", "brightness(1.08)");
          const rect = containerRef.current.getBoundingClientRect();
          setTooltip({
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
            d
          });
        })
        .on("mousemove", (event) => {
          const rect = containerRef.current.getBoundingClientRect();
          setTooltip(t => t ? ({
            ...t,
            x: event.clientX - rect.left,
            y: event.clientY - rect.top
          }) : null);
        })
        .on("mouseleave", () => {
          bar.attr("opacity", d.isFocused ? 1 : 0.9).attr("filter", "none");
          setTooltip(null);
        })
        .on("click", () => {
          if (onSelectScenario) onSelectScenario(d.id);
        });

        svg.append("text")
          .attr("class", "tp-d3-val-label")
          .attr("x", barX + barWidth / 2)
          .attr("y", barY - 14)
          .attr("text-anchor", "middle")
          .text(usd$(d.totalTax));

        let subText = "";
        let subColor = "var(--muted)";
        if (d.isBest) {
          subText = "★ Lowest";
          subColor = "#059669";
        } else if (d.isBaseline) {
          subText = "Baseline";
          subColor = "#2563eb";
        } else if (d.diffFromBest > 0) {
          subText = `+${usd(d.diffFromBest)}`;
        }

        if (subText) {
          svg.append("text")
            .attr("class", "tp-d3-sub-label")
            .attr("x", barX + barWidth / 2)
            .attr("y", barY - 3)
            .attr("text-anchor", "middle")
            .attr("fill", subColor)
            .attr("font-weight", d.isBest ? "700" : "500")
            .text(subText);
        }
      });
    } else {
      const keys = ["inc", "emp", "niit"];
      const colors = {
        inc: "#1e40af",
        emp: "#60a5fa",
        niit: "#f59e0b"
      };

      const stackGen = d3.stack().keys(keys);
      const series = stackGen(data);

      series.forEach(layer => {
        const color = colors[layer.key];
        layer.forEach(segment => {
          const d = segment.data;
          const bandwidth = xScale.bandwidth();
          const barWidth = Math.min(84, bandwidth);
          const barX = xScale(d.id) + (bandwidth - barWidth) / 2;
          const y0 = yScale(segment[0]);
          const y1 = yScale(segment[1]);
          const segHeight = Math.max(0, y0 - y1);

          if (segHeight > 0) {
            const seg = svg.append("rect")
              .attr("class", "tp-d3-bar")
              .attr("x", barX)
              .attr("y", y1)
              .attr("width", barWidth)
              .attr("height", segHeight)
              .attr("fill", color)
              .attr("opacity", d.isFocused ? 1 : 0.88);

            seg.on("mouseenter", (event) => {
              seg.attr("opacity", 1).attr("filter", "brightness(1.1)");
              const rect = containerRef.current.getBoundingClientRect();
              setTooltip({
                x: event.clientX - rect.left,
                y: event.clientY - rect.top,
                d,
                layerKey: layer.key
              });
            })
            .on("mousemove", (event) => {
              const rect = containerRef.current.getBoundingClientRect();
              setTooltip(t => t ? ({
                ...t,
                x: event.clientX - rect.left,
                y: event.clientY - rect.top
              }) : null);
            })
            .on("mouseleave", () => {
              seg.attr("opacity", d.isFocused ? 1 : 0.88).attr("filter", "none");
              setTooltip(null);
            })
            .on("click", () => {
              if (onSelectScenario) onSelectScenario(d.id);
            });
          }
        });
      });

      data.forEach(d => {
        const bandwidth = xScale.bandwidth();
        const barWidth = Math.min(84, bandwidth);
        const barX = xScale(d.id) + (bandwidth - barWidth) / 2;
        const barY = yScale(d.totalTax);

        svg.append("text")
          .attr("class", "tp-d3-val-label")
          .attr("x", barX + barWidth / 2)
          .attr("y", barY - 6)
          .attr("text-anchor", "middle")
          .text(usd$(d.totalTax));
      });
    }

    data.forEach(d => {
      const bandwidth = xScale.bandwidth();
      const barWidth = Math.min(84, bandwidth);
      const centerX = xScale(d.id) + (bandwidth - barWidth) / 2 + barWidth / 2;
      const labelY = height - margin.bottom + 16;

      const maxChars = Math.max(8, Math.floor(barWidth / 7));
      const displayName = d.name.length > maxChars ? d.name.slice(0, maxChars - 1) + "…" : d.name;

      const label = svg.append("text")
        .attr("class", "tp-d3-axis-x")
        .attr("x", centerX)
        .attr("y", labelY)
        .attr("text-anchor", "middle")
        .attr("fill", d.isFocused ? "var(--ink, #0f172a)" : "var(--ink2, #334155)")
        .attr("font-weight", d.isFocused ? "700" : "600")
        .attr("cursor", "pointer")
        .text((d.isBest ? "★ " : "") + displayName);

      label.on("click", () => {
        if (onSelectScenario) onSelectScenario(d.id);
      });

      svg.append("text")
        .attr("x", centerX)
        .attr("y", labelY + 14)
        .attr("text-anchor", "middle")
        .attr("fill", "var(--muted)")
        .attr("font-size", "10px")
        .text(pct(d.effectiveRate) + " eff.");
    });

    svg.append("line")
      .attr("x1", margin.left)
      .attr("x2", width - margin.right)
      .attr("y1", height - margin.bottom)
      .attr("y2", height - margin.bottom)
      .attr("stroke", "#cbd5e1");

  }, [data, dimensions, mode, onSelectScenario, maxTax]);

  return /*#__PURE__*/React.createElement("div", {
    className: "tp-d3-chart-wrap",
    ref: containerRef
  }, /*#__PURE__*/React.createElement("div", {
    className: "tp-d3-stat-strip"
  }, /*#__PURE__*/React.createElement("div", {
    className: "tp-d3-stat-item"
  }, /*#__PURE__*/React.createElement("span", {
    className: "tp-d3-stat-label"
  }, "Lowest Projected Tax:"), /*#__PURE__*/React.createElement("span", {
    className: "tp-d3-stat-val good"
  }, "★ " + usd$(minTax), bestResult ? ` (${bestResult.s.name})` : "")), baseline && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "tp-d3-stat-div"
  }), /*#__PURE__*/React.createElement("div", {
    className: "tp-d3-stat-item"
  }, /*#__PURE__*/React.createElement("span", {
    className: "tp-d3-stat-label"
  }, "Baseline Tax:"), /*#__PURE__*/React.createElement("span", {
    className: "tp-d3-stat-val"
  }, usd$(baselineTax)))), taxSpread > 0 && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "tp-d3-stat-div"
  }), /*#__PURE__*/React.createElement("div", {
    className: "tp-d3-stat-item"
  }, /*#__PURE__*/React.createElement("span", {
    className: "tp-d3-stat-label"
  }, "Max Tax Spread:"), /*#__PURE__*/React.createElement("span", {
    className: "tp-d3-stat-val good"
  }, usd$(taxSpread)))), focusedItem && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "tp-d3-stat-div",
    style: { marginLeft: "auto" }
  }), /*#__PURE__*/React.createElement("div", {
    className: "tp-d3-stat-item"
  }, /*#__PURE__*/React.createElement("span", {
    className: "tp-d3-stat-label"
  }, "Active:"), /*#__PURE__*/React.createElement("strong", {
    style: { color: "var(--indigo)" }
  }, focusedItem.name), /*#__PURE__*/React.createElement("span", {
    className: "tp-d3-stat-val"
  }, usd$(focusedItem.totalTax))))), /*#__PURE__*/React.createElement("svg", {
    ref: svgRef,
    className: "tp-d3-svg",
    height: 260
  }), tooltip && /*#__PURE__*/React.createElement("div", {
    className: "tp-d3-tooltip",
    style: {
      left: Math.max(120, Math.min(dimensions.width - 120, tooltip.x)),
      top: Math.max(10, tooltip.y - 12)
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "tp-d3-tooltip-head"
  }, /*#__PURE__*/React.createElement("span", null, tooltip.d.name), tooltip.d.isBest && /*#__PURE__*/React.createElement("span", {
    className: "tp-pill ok"
  }, "★ Lowest Tax"), tooltip.d.isBaseline && !tooltip.d.isBest && /*#__PURE__*/React.createElement("span", {
    className: "tp-pill"
  }, "Baseline")), /*#__PURE__*/React.createElement("div", {
    className: "tp-d3-tooltip-row"
  }, /*#__PURE__*/React.createElement("span", null, "Projected Total Tax:"), /*#__PURE__*/React.createElement("strong", {
    style: { color: tooltip.d.isBest ? "var(--green)" : "var(--ink)" }
  }, usd$(tooltip.d.totalTax))), /*#__PURE__*/React.createElement("div", {
    className: "tp-d3-tooltip-row"
  }, /*#__PURE__*/React.createElement("span", null, "Effective Tax Rate:"), /*#__PURE__*/React.createElement("strong", null, pct(tooltip.d.effectiveRate))), /*#__PURE__*/React.createElement("div", {
    className: "tp-d3-tooltip-row"
  }, /*#__PURE__*/React.createElement("span", null, "Federal Income Tax:"), /*#__PURE__*/React.createElement("span", null, usd$(tooltip.d.inc))), /*#__PURE__*/React.createElement("div", {
    className: "tp-d3-tooltip-row"
  }, /*#__PURE__*/React.createElement("span", null, "Employment / SE Tax:"), /*#__PURE__*/React.createElement("span", null, usd$(tooltip.d.emp))), tooltip.d.niit > 0 && /*#__PURE__*/React.createElement("div", {
    className: "tp-d3-tooltip-row"
  }, /*#__PURE__*/React.createElement("span", null, "NIIT / Surtax:"), /*#__PURE__*/React.createElement("span", null, usd$(tooltip.d.niit))), baseline && !tooltip.d.isBaseline && /*#__PURE__*/React.createElement("div", {
    className: "tp-d3-tooltip-row"
  }, /*#__PURE__*/React.createElement("span", null, "vs. Baseline:"), /*#__PURE__*/React.createElement("strong", {
    style: { color: tooltip.d.diffFromBaseline < 0 ? "var(--green)" : "var(--red)" }
  }, tooltip.d.diffFromBaseline < 0 ? `Saves ${usd$(-tooltip.d.diffFromBaseline)}` : `+${usd$(tooltip.d.diffFromBaseline)} tax`)), !tooltip.d.isBest && /*#__PURE__*/React.createElement("div", {
    className: "tp-d3-tooltip-row"
  }, /*#__PURE__*/React.createElement("span", null, "vs. Lowest Option:"), /*#__PURE__*/React.createElement("span", {
    style: { color: "var(--muted)" }
  }, `+${usd$(tooltip.d.diffFromBest)}`)), /*#__PURE__*/React.createElement("div", {
    className: "tp-d3-tooltip-note"
  }, "Click bar to inspect in Form 1040 walk and planning tools")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      flexWrap: "wrap",
      gap: "12px",
      marginTop: "12px",
      paddingTop: "10px",
      borderTop: "1px solid var(--line2)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "tp-legend"
  }, mode === "total" ? [
    /*#__PURE__*/React.createElement("i", { key: "best" },
      /*#__PURE__*/React.createElement("span", { className: "sw", style: { background: "#059669" } }),
      " Lowest Tax Scenario"
    ),
    baseline && /*#__PURE__*/React.createElement("i", { key: "base" },
      /*#__PURE__*/React.createElement("span", { className: "sw", style: { background: "#2563eb" } }),
      " Baseline Scenario"
    ),
    /*#__PURE__*/React.createElement("i", { key: "alt" },
      /*#__PURE__*/React.createElement("span", { className: "sw", style: { background: "#4f46e5" } }),
      " Planning Scenarios"
    ),
    /*#__PURE__*/React.createElement("i", { key: "active" },
      /*#__PURE__*/React.createElement("span", {
        className: "sw",
        style: {
          background: "transparent",
          border: "2px solid var(--ink, #0f172a)",
          borderRadius: "3px"
        }
      }),
      " Currently Active"
    )
  ] : [
    /*#__PURE__*/React.createElement("i", { key: "inc" },
      /*#__PURE__*/React.createElement("span", { className: "sw", style: { background: "#1e40af" } }),
      " Income Tax"
    ),
    /*#__PURE__*/React.createElement("i", { key: "emp" },
      /*#__PURE__*/React.createElement("span", { className: "sw", style: { background: "#60a5fa" } }),
      " SE & Payroll Tax"
    ),
    /*#__PURE__*/React.createElement("i", { key: "niit" },
      /*#__PURE__*/React.createElement("span", { className: "sw", style: { background: "#f59e0b" } }),
      " NIIT / Surtaxes"
    )
  ]), /*#__PURE__*/React.createElement("div", {
    style: { display: "flex", gap: "8px", alignItems: "center" }
  }, /*#__PURE__*/React.createElement(Seg, {
    small: true,
    value: mode,
    onChange: setMode,
    options: [
      { v: "total", l: "Total Liability" },
      { v: "breakdown", l: "Tax Components" }
    ]
  }), /*#__PURE__*/React.createElement(Seg, {
    small: true,
    value: sortBy,
    onChange: setSortBy,
    options: [
      { v: "default", l: "Scenario Order" },
      { v: "lowest", l: "Lowest Tax First" }
    ]
  }))));
}

