import { createRequire as tx } from 'node:module';
var Kb = Object.create;
var { getPrototypeOf: Jb, defineProperty: qr, getOwnPropertyNames: Yu, getOwnPropertyDescriptor: Hb } = Object,
	Wo = Object.prototype.hasOwnProperty;
function Qu(e) {
	return this[e];
}
var Gb,
	Wb,
	Xu = (e, t, r) => {
		var n = e != null && typeof e === 'object';
		if (n) {
			var i = t ? Gb ??= new WeakMap() : Wb ??= new WeakMap(), o = i.get(e);
			if (o) return o;
		}
		r = e != null ? Kb(Jb(e)) : {};
		let s = t || !e || !e.__esModule || !Wo.call(e, 'default') ? qr(r, 'default', { value: e, enumerable: !0 }) : r;
		if (e && typeof e === 'object' || typeof e === 'function') {
			for (let a of Yu(e)) if (!Wo.call(s, a)) qr(s, a, { get: Qu.bind(e, a), enumerable: !0 });
		}
		if (n) i.set(e, s);
		return s;
	},
	Yb = (e) => {
		var t = (Wu ??= new WeakMap()).get(e), r;
		if (t) return t;
		if (t = qr({}, '__esModule', { value: !0 }), e && typeof e === 'object' || typeof e === 'function') {
			for (var n of Yu(e)) {
				if (!Wo.call(t, n)) qr(t, n, { get: Qu.bind(e, n), enumerable: !(r = Hb(e, n)) || r.enumerable });
			}
		}
		return Wu.set(e, t), t;
	},
	Wu,
	D = (e, t) => () => (t || e((t = { exports: {} }).exports, t), t.exports);
var Qb = (e) => e;
function Xb(e, t) {
	this[e] = Qb.bind(null, t);
}
var el = (e, t) => {
	for (var r in t) qr(e, r, { get: t[r], enumerable: !0, configurable: !0, set: Xb.bind(t, r) });
};
var ex = (e, t, r) => () => {
	if (e) {
		try {
			t = e(e = 0);
		} catch (n) {
			r = [n];
		}
	}
	if (r) throw r[0];
	return t;
};
var ar = tx(import.meta.url);
var W = D(function(ux) {
	var Yo = Symbol.for('yaml.alias'),
		tl = Symbol.for('yaml.document'),
		Rn = Symbol.for('yaml.map'),
		rl = Symbol.for('yaml.pair'),
		Qo = Symbol.for('yaml.scalar'),
		Bn = Symbol.for('yaml.seq'),
		it = Symbol.for('yaml.node.type'),
		rx = (e) => !!e && typeof e === 'object' && e[it] === Yo,
		nx = (e) => !!e && typeof e === 'object' && e[it] === tl,
		ix = (e) => !!e && typeof e === 'object' && e[it] === Rn,
		ox = (e) => !!e && typeof e === 'object' && e[it] === rl,
		nl = (e) => !!e && typeof e === 'object' && e[it] === Qo,
		sx = (e) => !!e && typeof e === 'object' && e[it] === Bn;
	function il(e) {
		if (e && typeof e === 'object') {
			switch (e[it]) {
				case Rn:
				case Bn:
					return !0;
			}
		}
		return !1;
	}
	function ax(e) {
		if (e && typeof e === 'object') {
			switch (e[it]) {
				case Yo:
				case Rn:
				case Qo:
				case Bn:
					return !0;
			}
		}
		return !1;
	}
	var cx = (e) => (nl(e) || il(e)) && !!e.anchor;
	ux.ALIAS = Yo;
	ux.DOC = tl;
	ux.MAP = Rn;
	ux.NODE_TYPE = it;
	ux.PAIR = rl;
	ux.SCALAR = Qo;
	ux.SEQ = Bn;
	ux.hasAnchor = cx;
	ux.isAlias = rx;
	ux.isCollection = il;
	ux.isDocument = nx;
	ux.isMap = ix;
	ux.isNode = ax;
	ux.isPair = ox;
	ux.isScalar = nl;
	ux.isSeq = sx;
});
var Dr = D(function(zx) {
	var fe = W(), ve = Symbol('break visit'), ol = Symbol('skip children'), Ke = Symbol('remove node');
	function Zn(e, t) {
		let r = sl(t);
		if (fe.isDocument(e)) { if (cr(null, e.contents, r, Object.freeze([e])) === Ke) e.contents = null; }
		else cr(null, e, r, Object.freeze([]));
	}
	Zn.BREAK = ve;
	Zn.SKIP = ol;
	Zn.REMOVE = Ke;
	function cr(e, t, r, n) {
		let i = al(e, t, r, n);
		if (fe.isNode(i) || fe.isPair(i)) return cl(e, n, i), cr(e, i, r, n);
		if (typeof i !== 'symbol') {
			if (fe.isCollection(t)) {
				n = Object.freeze(n.concat(t));
				for (let o = 0; o < t.items.length; ++o) {
					let s = cr(o, t.items[o], r, n);
					if (typeof s === 'number') o = s - 1;
					else if (s === ve) return ve;
					else if (s === Ke) t.items.splice(o, 1), o -= 1;
				}
			} else if (fe.isPair(t)) {
				n = Object.freeze(n.concat(t));
				let o = cr('key', t.key, r, n);
				if (o === ve) return ve;
				else if (o === Ke) t.key = null;
				let s = cr('value', t.value, r, n);
				if (s === ve) return ve;
				else if (s === Ke) t.value = null;
			}
		}
		return i;
	}
	async function jn(e, t) {
		let r = sl(t);
		if (fe.isDocument(e)) { if (await ur(null, e.contents, r, Object.freeze([e])) === Ke) e.contents = null; }
		else await ur(null, e, r, Object.freeze([]));
	}
	jn.BREAK = ve;
	jn.SKIP = ol;
	jn.REMOVE = Ke;
	async function ur(e, t, r, n) {
		let i = await al(e, t, r, n);
		if (fe.isNode(i) || fe.isPair(i)) return cl(e, n, i), ur(e, i, r, n);
		if (typeof i !== 'symbol') {
			if (fe.isCollection(t)) {
				n = Object.freeze(n.concat(t));
				for (let o = 0; o < t.items.length; ++o) {
					let s = await ur(o, t.items[o], r, n);
					if (typeof s === 'number') o = s - 1;
					else if (s === ve) return ve;
					else if (s === Ke) t.items.splice(o, 1), o -= 1;
				}
			} else if (fe.isPair(t)) {
				n = Object.freeze(n.concat(t));
				let o = await ur('key', t.key, r, n);
				if (o === ve) return ve;
				else if (o === Ke) t.key = null;
				let s = await ur('value', t.value, r, n);
				if (s === ve) return ve;
				else if (s === Ke) t.value = null;
			}
		}
		return i;
	}
	function sl(e) {
		if (typeof e === 'object' && (e.Collection || e.Node || e.Value)) {
			return Object.assign(
				{ Alias: e.Node, Map: e.Node, Scalar: e.Node, Seq: e.Node },
				e.Value && { Map: e.Value, Scalar: e.Value, Seq: e.Value },
				e.Collection && { Map: e.Collection, Seq: e.Collection },
				e,
			);
		}
		return e;
	}
	function al(e, t, r, n) {
		if (typeof r === 'function') return r(e, t, n);
		if (fe.isMap(t)) return r.Map?.(e, t, n);
		if (fe.isSeq(t)) return r.Seq?.(e, t, n);
		if (fe.isPair(t)) return r.Pair?.(e, t, n);
		if (fe.isScalar(t)) return r.Scalar?.(e, t, n);
		if (fe.isAlias(t)) return r.Alias?.(e, t, n);
		return;
	}
	function cl(e, t, r) {
		let n = t[t.length - 1];
		if (fe.isCollection(n)) n.items[e] = r;
		else if (fe.isPair(n)) {
			if (e === 'key') n.key = r;
			else n.value = r;
		} else if (fe.isDocument(n)) n.contents = r;
		else {
			let i = fe.isAlias(n) ? 'alias' : 'scalar';
			throw Error(`Cannot replace node with ${i} parent`);
		}
	}
	zx.visit = Zn;
	zx.visitAsync = jn;
});
var Xo = D(function(Ox) {
	var ul = W(),
		Ex = Dr(),
		Ix = { '!': '%21', ',': '%2C', '[': '%5B', ']': '%5D', '{': '%7B', '}': '%7D' },
		Px = (e) => e.replace(/[!,[\]{}]/g, (t) => Ix[t]);
	class Oe {
		constructor(e, t) {
			this.docStart = null,
				this.docEnd = !1,
				this.yaml = Object.assign({}, Oe.defaultYaml, e),
				this.tags = Object.assign({}, Oe.defaultTags, t);
		}
		clone() {
			let e = new Oe(this.yaml, this.tags);
			return e.docStart = this.docStart, e;
		}
		atDocument() {
			let e = new Oe(this.yaml, this.tags);
			switch (this.yaml.version) {
				case '1.1':
					this.atNextDocument = !0;
					break;
				case '1.2':
					this.atNextDocument = !1,
						this.yaml = { explicit: Oe.defaultYaml.explicit, version: '1.2' },
						this.tags = Object.assign({}, Oe.defaultTags);
					break;
			}
			return e;
		}
		add(e, t) {
			if (this.atNextDocument) {
				this.yaml = { explicit: Oe.defaultYaml.explicit, version: '1.1' },
					this.tags = Object.assign({}, Oe.defaultTags),
					this.atNextDocument = !1;
			}
			let r = e.trim().split(/[ \t]+/), n = r.shift();
			switch (n) {
				case '%TAG': {
					if (r.length !== 2) { if (t(0, '%TAG directive should contain exactly two parts'), r.length < 2) return !1; }
					let [i, o] = r;
					return this.tags[i] = o, !0;
				}
				case '%YAML': {
					if (this.yaml.explicit = !0, r.length !== 1) {
						return t(0, '%YAML directive should contain exactly one part'), !1;
					}
					let [i] = r;
					if (i === '1.1' || i === '1.2') return this.yaml.version = i, !0;
					else {
						let o = /^\d+\.\d+$/.test(i);
						return t(6, `Unsupported YAML version ${i}`, o), !1;
					}
				}
				default:
					return t(0, `Unknown directive ${n}`, !0), !1;
			}
		}
		tagName(e, t) {
			if (e === '!') return '!';
			if (e[0] !== '!') return t(`Not a valid tag: ${e}`), null;
			if (e[1] === '<') {
				let o = e.slice(2, -1);
				if (o === '!' || o === '!!') return t(`Verbatim tags aren't resolved, so ${e} is invalid.`), null;
				if (e[e.length - 1] !== '>') t('Verbatim tags must end with a >');
				return o;
			}
			let [, r, n] = e.match(/^(.*!)([^!]*)$/s);
			if (!n) t(`The ${e} tag has no suffix`);
			let i = this.tags[r];
			if (i) {
				try {
					return i + decodeURIComponent(n);
				} catch (o) {
					return t(String(o)), null;
				}
			}
			if (r === '!') return e;
			return t(`Could not resolve tag: ${e}`), null;
		}
		tagString(e) {
			for (let [t, r] of Object.entries(this.tags)) if (e.startsWith(r)) return t + Px(e.substring(r.length));
			return e[0] === '!' ? e : `!<${e}>`;
		}
		toString(e) {
			let t = this.yaml.explicit ? [`%YAML ${this.yaml.version || '1.2'}`] : [], r = Object.entries(this.tags), n;
			if (e && r.length > 0 && ul.isNode(e.contents)) {
				let i = {};
				Ex.visit(e.contents, (o, s) => {
					if (ul.isNode(s) && s.tag) i[s.tag] = !0;
				}), n = Object.keys(i);
			} else n = [];
			for (let [i, o] of r) {
				if (i === '!!' && o === 'tag:yaml.org,2002:') continue;
				if (!e || n.some((s) => s.startsWith(o))) t.push(`%TAG ${i} ${o}`);
			}
			return t.join(`
`);
		}
	}
	Oe.defaultYaml = { explicit: !1, version: '1.2' };
	Oe.defaultTags = { '!!': 'tag:yaml.org,2002:' };
	Ox.Directives = Oe;
});
var Un = D(function(Dx) {
	var ll = W(), Lx = Dr();
	function Nx(e) {
		if (/[\x00-\x19\s,[\]{}]/.test(e)) {
			let r = `Anchor must not contain whitespace or control characters: ${JSON.stringify(e)}`;
			throw Error(r);
		}
		return !0;
	}
	function fl(e) {
		let t = new Set();
		return Lx.visit(e, {
			Value(r, n) {
				if (n.anchor) t.add(n.anchor);
			},
		}),
			t;
	}
	function pl(e, t) {
		for (let r = 1;; ++r) {
			let n = `${e}${r}`;
			if (!t.has(n)) return n;
		}
	}
	function qx(e, t) {
		let r = [], n = new Map(), i = null;
		return {
			onAnchor: (o) => {
				r.push(o), i ?? (i = fl(e));
				let s = pl(t, i);
				return i.add(s), s;
			},
			setAnchors: () => {
				for (let o of r) {
					let s = n.get(o);
					if (typeof s === 'object' && s.anchor && (ll.isScalar(s.node) || ll.isCollection(s.node))) {
						s.node.anchor = s.anchor;
					} else {
						let a = Error('Failed to resolve repeated object (this should not happen)');
						throw a.source = o, a;
					}
				}
			},
			sourceObjects: n,
		};
	}
	Dx.anchorIsValid = Nx;
	Dx.anchorNames = fl;
	Dx.createNodeAnchors = qx;
	Dx.findNewAnchor = pl;
});
var es = D(function(Zx) {
	function Mr(e, t, r, n) {
		if (n && typeof n === 'object') {
			if (Array.isArray(n)) {
				for (let i = 0, o = n.length; i < o; ++i) {
					let s = n[i], a = Mr(e, n, String(i), s);
					if (a === void 0) delete n[i];
					else if (a !== s) n[i] = a;
				}
			} else if (n instanceof Map) {
				for (let i of Array.from(n.keys())) {
					let o = n.get(i), s = Mr(e, n, i, o);
					if (s === void 0) n.delete(i);
					else if (s !== o) n.set(i, s);
				}
			} else if (n instanceof Set) {
				for (let i of Array.from(n)) {
					let o = Mr(e, n, i, i);
					if (o === void 0) n.delete(i);
					else if (o !== i) n.delete(i), n.add(o);
				}
			} else {for (let [i, o] of Object.entries(n)) {
					let s = Mr(e, n, i, o);
					if (s === void 0) delete n[i];
					else if (s !== o) n[i] = s;
				}}
		}
		return e.call(t, r, n);
	}
	Zx.applyReviver = Mr;
});
var ft = D(function(Vx) {
	var Ux = W();
	function hl(e, t, r) {
		if (Array.isArray(e)) return e.map((n, i) => hl(n, String(i), r));
		if (e && typeof e.toJSON === 'function') {
			if (!r || !Ux.hasAnchor(e)) return e.toJSON(t, r);
			let n = { aliasCount: 0, count: 1, res: void 0 };
			r.anchors.set(e, n),
				r.onCreate = (o) => {
					n.res = o, delete r.onCreate;
				};
			let i = e.toJSON(t, r);
			if (r.onCreate) r.onCreate(i);
			return i;
		}
		if (typeof e === 'bigint' && !r?.keep) return Number(e);
		return e;
	}
	Vx.toJS = hl;
});
var Vn = D(function(Gx) {
	var Jx = es(), dl = W(), Hx = ft();
	class ml {
		constructor(e) {
			Object.defineProperty(this, dl.NODE_TYPE, { value: e });
		}
		clone() {
			let e = Object.create(Object.getPrototypeOf(this), Object.getOwnPropertyDescriptors(this));
			if (this.range) e.range = this.range.slice();
			return e;
		}
		toJS(e, { mapAsMap: t, maxAliasCount: r, onAnchor: n, reviver: i } = {}) {
			if (!dl.isDocument(e)) throw TypeError('A document argument is required');
			let o = {
					anchors: new Map(),
					doc: e,
					keep: !0,
					mapAsMap: t === !0,
					mapKeyWarned: !1,
					maxAliasCount: typeof r === 'number' ? r : 100,
				},
				s = Hx.toJS(this, '', o);
			if (typeof n === 'function') { for (let { count: a, res: c } of o.anchors.values()) n(c, a); }
			return typeof i === 'function' ? Jx.applyReviver(i, { '': s }, '', s) : s;
		}
	}
	Gx.NodeBase = ml;
});
var Fr = D(function(tk) {
	var Yx = Un(), Qx = Dr(), lr = W(), Xx = Vn(), ek = ft();
	class gl extends Xx.NodeBase {
		constructor(e) {
			super(lr.ALIAS);
			this.source = e,
				Object.defineProperty(this, 'tag', {
					set() {
						throw Error('Alias nodes cannot have tags');
					},
				});
		}
		resolve(e, t) {
			if (t?.maxAliasCount === 0) throw ReferenceError('Alias resolution is disabled');
			let r;
			if (t?.aliasResolveCache) r = t.aliasResolveCache;
			else if (
				r = [],
					Qx.visit(e, {
						Node: (i, o) => {
							if (lr.isAlias(o) || lr.hasAnchor(o)) r.push(o);
						},
					}),
					t
			) t.aliasResolveCache = r;
			let n = void 0;
			for (let i of r) {
				if (i === this) break;
				if (i.anchor === this.source) n = i;
			}
			if (n && t) {
				let { anchors: i, doc: o, maxAliasCount: s } = t, a = i.get(n);
				if (!a) ek.toJS(n, null, t), a = i.get(n);
				if (a?.res === void 0) throw ReferenceError('This should not happen: Alias anchor was not resolved?');
				if (s >= 0) {
					if (a.count += 1, a.aliasCount === 0) a.aliasCount = Kn(o, n, i);
					if (a.count * a.aliasCount > s) {
						throw ReferenceError('Excessive alias count indicates a resource exhaustion attack');
					}
				}
			}
			return n;
		}
		toJSON(e, t) {
			if (!t) return { source: this.source };
			let r = this.resolve(t.doc, t);
			if (!r) {
				let n = `Unresolved alias (the anchor must be set before the alias): ${this.source}`;
				throw ReferenceError(n);
			}
			return t.anchors.get(r).res;
		}
		toString(e, t, r) {
			let n = `*${this.source}`;
			if (e) {
				if (Yx.anchorIsValid(this.source), e.options.verifyAliasOrder && !e.anchors.has(this.source)) {
					let i = `Unresolved alias (the anchor must be set before the alias): ${this.source}`;
					throw Error(i);
				}
				if (e.implicitKey) return `${n} `;
			}
			return n;
		}
	}
	function Kn(e, t, r) {
		if (lr.isAlias(t)) {
			let n = t.resolve(e), i = r && n && r.get(n);
			return i ? i.count * i.aliasCount : 0;
		} else if (lr.isCollection(t)) {
			let n = 0;
			for (let i of t.items) {
				let o = Kn(e, i, r);
				if (o > n) n = o;
			}
			return n;
		} else if (lr.isPair(t)) {
			let n = Kn(e, t.key, r), i = Kn(e, t.value, r);
			return Math.max(n, i);
		}
		return 1;
	}
	tk.Alias = gl;
});
var ce = D(function(ak) {
	var nk = W(), ik = Vn(), ok = ft(), sk = (e) => !e || typeof e !== 'function' && typeof e !== 'object';
	class Lt extends ik.NodeBase {
		constructor(e) {
			super(nk.SCALAR);
			this.value = e;
		}
		toJSON(e, t) {
			return t?.keep ? this.value : ok.toJS(this.value, e, t);
		}
		toString() {
			return String(this.value);
		}
	}
	Lt.BLOCK_FOLDED = 'BLOCK_FOLDED';
	Lt.BLOCK_LITERAL = 'BLOCK_LITERAL';
	Lt.PLAIN = 'PLAIN';
	Lt.QUOTE_DOUBLE = 'QUOTE_DOUBLE';
	Lt.QUOTE_SINGLE = 'QUOTE_SINGLE';
	ak.Scalar = Lt;
	ak.isScalarValue = sk;
});
var Rr = D(function(dk) {
	var lk = Fr(), Nt = W(), yl = ce(), fk = 'tag:yaml.org,2002:';
	function pk(e, t, r) {
		if (t) {
			let n = r.filter((o) => o.tag === t), i = n.find((o) => !o.format) ?? n[0];
			if (!i) throw Error(`Tag ${t} not found`);
			return i;
		}
		return r.find((n) => n.identify?.(e) && !n.format);
	}
	function hk(e, t, r) {
		if (Nt.isDocument(e)) e = e.contents;
		if (Nt.isNode(e)) return e;
		if (Nt.isPair(e)) {
			let f = r.schema[Nt.MAP].createNode?.(r.schema, null, r);
			return f.items.push(e), f;
		}
		if (
			e instanceof String || e instanceof Number || e instanceof Boolean || typeof BigInt < 'u' && e instanceof BigInt
		) e = e.valueOf();
		let { aliasDuplicateObjects: n, onAnchor: i, onTagObj: o, schema: s, sourceObjects: a } = r, c = void 0;
		if (n && e && typeof e === 'object') {
			if (c = a.get(e), c) return c.anchor ?? (c.anchor = i(e)), new lk.Alias(c.anchor);
			else c = { anchor: null, node: null }, a.set(e, c);
		}
		if (t?.startsWith('!!')) t = fk + t.slice(2);
		let u = pk(e, t, s.tags);
		if (!u) {
			if (e && typeof e.toJSON === 'function') e = e.toJSON();
			if (!e || typeof e !== 'object') {
				let f = new yl.Scalar(e);
				if (c) c.node = f;
				return f;
			}
			u = e instanceof Map ? s[Nt.MAP] : (Symbol.iterator in Object(e)) ? s[Nt.SEQ] : s[Nt.MAP];
		}
		if (o) o(u), delete r.onTagObj;
		let l = u?.createNode
			? u.createNode(r.schema, e, r)
			: typeof u?.nodeClass?.from === 'function'
			? u.nodeClass.from(r.schema, e, r)
			: new yl.Scalar(e);
		if (t) l.tag = t;
		else if (!u.default) l.tag = u.tag;
		if (c) c.node = l;
		return l;
	}
	dk.createNode = hk;
});
var Jn = D(function(bk) {
	var gk = Rr(), Je = W(), yk = Vn();
	function ts(e, t, r) {
		let n = r;
		for (let i = t.length - 1; i >= 0; --i) {
			let o = t[i];
			if (typeof o === 'number' && Number.isInteger(o) && o >= 0) {
				let s = [];
				s[o] = n, n = s;
			} else n = new Map([[o, n]]);
		}
		return gk.createNode(n, void 0, {
			aliasDuplicateObjects: !1,
			keepUndefined: !1,
			onAnchor: () => {
				throw Error('This should not happen, please report a bug.');
			},
			schema: e,
			sourceObjects: new Map(),
		});
	}
	var bl = (e) => e == null || typeof e === 'object' && !!e[Symbol.iterator]().next().done;
	class xl extends yk.NodeBase {
		constructor(e, t) {
			super(e);
			Object.defineProperty(this, 'schema', { value: t, configurable: !0, enumerable: !1, writable: !0 });
		}
		clone(e) {
			let t = Object.create(Object.getPrototypeOf(this), Object.getOwnPropertyDescriptors(this));
			if (e) t.schema = e;
			if (t.items = t.items.map((r) => Je.isNode(r) || Je.isPair(r) ? r.clone(e) : r), this.range) {
				t.range = this.range.slice();
			}
			return t;
		}
		addIn(e, t) {
			if (bl(e)) this.add(t);
			else {
				let [r, ...n] = e, i = this.get(r, !0);
				if (Je.isCollection(i)) i.addIn(n, t);
				else if (i === void 0 && this.schema) this.set(r, ts(this.schema, n, t));
				else throw Error(`Expected YAML collection at ${r}. Remaining path: ${n}`);
			}
		}
		deleteIn(e) {
			let [t, ...r] = e;
			if (r.length === 0) return this.delete(t);
			let n = this.get(t, !0);
			if (Je.isCollection(n)) return n.deleteIn(r);
			else throw Error(`Expected YAML collection at ${t}. Remaining path: ${r}`);
		}
		getIn(e, t) {
			let [r, ...n] = e, i = this.get(r, !0);
			if (n.length === 0) return !t && Je.isScalar(i) ? i.value : i;
			else return Je.isCollection(i) ? i.getIn(n, t) : void 0;
		}
		hasAllNullValues(e) {
			return this.items.every((t) => {
				if (!Je.isPair(t)) return !1;
				let r = t.value;
				return r == null || e && Je.isScalar(r) && r.value == null && !r.commentBefore && !r.comment && !r.tag;
			});
		}
		hasIn(e) {
			let [t, ...r] = e;
			if (r.length === 0) return this.has(t);
			let n = this.get(t, !0);
			return Je.isCollection(n) ? n.hasIn(r) : !1;
		}
		setIn(e, t) {
			let [r, ...n] = e;
			if (n.length === 0) this.set(r, t);
			else {
				let i = this.get(r, !0);
				if (Je.isCollection(i)) i.setIn(n, t);
				else if (i === void 0 && this.schema) this.set(r, ts(this.schema, n, t));
				else throw Error(`Expected YAML collection at ${r}. Remaining path: ${n}`);
			}
		}
	}
	bk.Collection = xl;
	bk.collectionFromPath = ts;
	bk.isEmptyPath = bl;
});
var Br = D(function(_k) {
	var Sk = (e) => e.replace(/^(?!$)(?: $)?/gm, '#');
	function rs(e, t) {
		if (/^\n+$/.test(e)) return e.substring(1);
		return t ? e.replace(/^(?! *$)/gm, t) : e;
	}
	var vk = (e, t, r) =>
		e.endsWith(`
`)
			? rs(r, t)
			: r.includes(`
`)
			? `
` + rs(r, t)
			: (e.endsWith(' ') ? '' : ' ') + r;
	_k.indentComment = rs;
	_k.lineComment = vk;
	_k.stringifyComment = Sk;
});
var wl = D(function(Ek) {
	function Ak(
		e,
		t,
		r = 'flow',
		{ indentAtStart: n, lineWidth: i = 80, minContentWidth: o = 20, onFold: s, onOverflow: a } = {},
	) {
		if (!i || i < 0) return e;
		if (i < o) o = 0;
		let c = Math.max(1 + o, 1 + i - t.length);
		if (e.length <= c) return e;
		let u = [], l = {}, f = i - t.length;
		if (typeof n === 'number') {
			if (n > i - Math.max(2, o)) u.push(0);
			else f = i - n;
		}
		let h = void 0, d = void 0, g = !1, y = -1, x = -1, k = -1;
		if (r === 'block') { if (y = kl(e, y, t.length), y !== -1) f = y + c; }
		for (let _; _ = e[y += 1];) {
			if (r === 'quoted' && _ === '\\') {
				switch (x = y, e[y + 1]) {
					case 'x':
						y += 3;
						break;
					case 'u':
						y += 5;
						break;
					case 'U':
						y += 9;
						break;
					default:
						y += 1;
				}
				k = y;
			}
			if (
				_ === `
`
			) {
				if (r === 'block') y = kl(e, y, t.length);
				f = y + t.length + c, h = void 0;
			} else {
				if (
					_ === ' ' && d && d !== ' ' && d !== `
`
					&& d !== '\t'
				) {
					let O = e[y + 1];
					if (
						O && O !== ' ' && O !== `
`
						&& O !== '\t'
					) h = y;
				}
				if (y >= f) {
					if (h) u.push(h), f = h + c, h = void 0;
					else if (r === 'quoted') {
						while (d === ' ' || d === '\t') d = _, _ = e[y += 1], g = !0;
						let O = y > k + 1 ? y - 2 : x - 1;
						if (l[O]) return e;
						u.push(O), l[O] = !0, f = O + c, h = void 0;
					} else g = !0;
				}
			}
			d = _;
		}
		if (g && a) a();
		if (u.length === 0) return e;
		if (s) s();
		let z = e.slice(0, u[0]);
		for (let _ = 0; _ < u.length; ++_) {
			let O = u[_], I = u[_ + 1] || e.length;
			if (O === 0) {
				z = `
${t}${e.slice(0, I)}`;
			} else {
				if (r === 'quoted' && l[O]) z += `${e[O]}\\`;
				z += `
${t}${e.slice(O + 1, I)}`;
			}
		}
		return z;
	}
	function kl(e, t, r) {
		let n = t, i = t + 1, o = e[i];
		while (o === ' ' || o === '\t') {
			if (t < i + r) o = e[++t];
			else {
				do o = e[++t]; while (
					o && o !== `
`
				);
				n = t, i = t + 1, o = e[i];
			}
		}
		return n;
	}
	Ek.FOLD_BLOCK = 'block';
	Ek.FOLD_FLOW = 'flow';
	Ek.FOLD_QUOTED = 'quoted';
	Ek.foldFlowLines = Ak;
});
var jr = D(function(Dk) {
	var De = ce(),
		pt = wl(),
		Gn = (e, t) => ({
			indentAtStart: t ? e.indent.length : e.indentAtStart,
			lineWidth: e.options.lineWidth,
			minContentWidth: e.options.minContentWidth,
		}),
		Wn = (e) => /^(%|---|\.\.\.)/m.test(e);
	function Lk(e, t, r) {
		if (!t || t < 0) return !1;
		let n = t - r, i = e.length;
		if (i <= n) return !1;
		for (let o = 0, s = 0; o < i; ++o) {
			if (
				e[o] === `
`
			) {
				if (o - s > n) return !0;
				if (s = o + 1, i - s <= n) return !1;
			}
		}
		return !0;
	}
	function Zr(e, t) {
		let r = JSON.stringify(e);
		if (t.options.doubleQuotedAsJSON) return r;
		let { implicitKey: n } = t,
			i = t.options.doubleQuotedMinMultiLineLength,
			o = t.indent || (Wn(e) ? '  ' : ''),
			s = '',
			a = 0;
		for (let c = 0, u = r[c]; u; u = r[++c]) {
			if (u === ' ' && r[c + 1] === '\\' && r[c + 2] === 'n') s += r.slice(a, c) + '\\ ', c += 1, a = c, u = '\\';
			if (u === '\\') {
				switch (r[c + 1]) {
					case 'u':
						{
							s += r.slice(a, c);
							let l = r.substr(c + 2, 4);
							switch (l) {
								case '0000':
									s += '\\0';
									break;
								case '0007':
									s += '\\a';
									break;
								case '000b':
									s += '\\v';
									break;
								case '001b':
									s += '\\e';
									break;
								case '0085':
									s += '\\N';
									break;
								case '00a0':
									s += '\\_';
									break;
								case '2028':
									s += '\\L';
									break;
								case '2029':
									s += '\\P';
									break;
								default:
									if (l.substr(0, 2) === '00') s += '\\x' + l.substr(2);
									else s += r.substr(c, 6);
							}
							c += 5, a = c + 1;
						}
						break;
					case 'n':
						if (n || r[c + 2] === '"' || r.length < i) c += 1;
						else {
							s += r.slice(a, c) + `

`;
							while (r[c + 2] === '\\' && r[c + 3] === 'n' && r[c + 4] !== '"') {
								s += `
`, c += 2;
							}
							if (s += o, r[c + 2] === ' ') s += '\\';
							c += 1, a = c + 1;
						}
						break;
					default:
						c += 1;
				}
			}
		}
		return s = a ? s + r.slice(a) : r, n ? s : pt.foldFlowLines(s, o, pt.FOLD_QUOTED, Gn(t, !1));
	}
	function ns(e, t) {
		if (
			t.options.singleQuote === !1 || t.implicitKey && e.includes(`
`)
			|| /[ \t]\n|\n[ \t]/.test(e)
		) return Zr(e, t);
		let r = t.indent || (Wn(e) ? '  ' : ''),
			n = "'" + e.replace(/'/g, "''").replace(
				/\n+/g,
				`$&
${r}`,
			) + "'";
		return t.implicitKey ? n : pt.foldFlowLines(n, r, pt.FOLD_FLOW, Gn(t, !1));
	}
	function fr(e, t) {
		let { singleQuote: r } = t.options, n;
		if (r === !1) n = Zr;
		else {
			let i = e.includes('"'), o = e.includes("'");
			if (i && !o) n = ns;
			else if (o && !i) n = Zr;
			else n = r ? ns : Zr;
		}
		return n(e, t);
	}
	var is;
	try {
		is = new RegExp(
			`(^|(?<!
))
+(?!
|$)`,
			'g',
		);
	} catch {
		is = /\n+(?!\n|$)/g;
	}
	function Hn({ comment: e, type: t, value: r }, n, i, o) {
		let { blockQuote: s, commentString: a, lineWidth: c } = n.options;
		if (!s || /\n[\t ]+$/.test(r)) return fr(r, n);
		let u = n.indent || (n.forceBlockIndent || Wn(r) ? '  ' : ''),
			l = s === 'literal'
				? !0
				: s === 'folded' || t === De.Scalar.BLOCK_FOLDED
				? !1
				: t === De.Scalar.BLOCK_LITERAL
				? !0
				: !Lk(r, c, u.length);
		if (!r) {
			return l
				? `|
`
				: `>
`;
		}
		let f, h;
		for (h = r.length; h > 0; --h) {
			let I = r[h - 1];
			if (
				I !== `
` && I !== '\t' && I !== ' '
			) break;
		}
		let d = r.substring(h),
			g = d.indexOf(`
`);
		if (g === -1) f = '-';
		else if (r === d || g !== d.length - 1) { if (f = '+', o) o(); }
		else f = '';
		if (d) {
			if (
				r = r.slice(0, -d.length),
					d[d.length - 1] === `
`
			) d = d.slice(0, -1);
			d = d.replace(is, `$&${u}`);
		}
		let y = !1, x, k = -1;
		for (x = 0; x < r.length; ++x) {
			let I = r[x];
			if (I === ' ') y = !0;
			else if (
				I === `
`
			) k = x;
			else break;
		}
		let z = r.substring(0, k < x ? k + 1 : x);
		if (z) r = r.substring(z.length), z = z.replace(/\n+/g, `$&${u}`);
		let O = (y ? u ? '2' : '1' : '') + f;
		if (e) { if (O += ' ' + a(e.replace(/ ?[\r\n]+/g, ' ')), i) i(); }
		if (!l) {
			let I = r.replace(
					/\n+/g,
					`
$&`,
				).replace(/(?:^|\n)([\t ].*)(?:([\n\t ]*)\n(?![\n\t ]))?/g, '$1$2').replace(/\n+/g, `$&${u}`),
				v = !1,
				q = Gn(n, !0);
			if (s !== 'folded' && t !== De.Scalar.BLOCK_FOLDED) {
				q.onOverflow = () => {
					v = !0;
				};
			}
			let L = pt.foldFlowLines(`${z}${I}${d}`, u, pt.FOLD_BLOCK, q);
			if (!v) {
				return `>${O}
${u}${L}`;
			}
		}
		return r = r.replace(/\n+/g, `$&${u}`),
			`|${O}
${u}${z}${r}${d}`;
	}
	function Nk(e, t, r, n) {
		let { type: i, value: o } = e, { actualString: s, implicitKey: a, indent: c, indentStep: u, inFlow: l } = t;
		if (
			a && o.includes(`
`) || l
				&& /[[\]{},]/.test(o)
		) return fr(o, t);
		if (/^[\n\t ,[\]{}#&*!|>'"%@`]|^[?-]$|^[?-][ \t]|[\n:][ \t]|[ \t]\n|[\n\t ]#|[\n\t :]$/.test(o)) {
			return a || l || !o.includes(`
`)
				? fr(o, t)
				: Hn(e, t, r, n);
		}
		if (
			!a && !l && i !== De.Scalar.PLAIN && o.includes(`
`)
		) return Hn(e, t, r, n);
		if (Wn(o)) {
			if (c === '') return t.forceBlockIndent = !0, Hn(e, t, r, n);
			else if (a && c === u) return fr(o, t);
		}
		let f = o.replace(
			/\n+/g,
			`$&
${c}`,
		);
		if (s) {
			let h = (y) => y.default && y.tag !== 'tag:yaml.org,2002:str' && y.test?.test(f),
				{ compat: d, tags: g } = t.doc.schema;
			if (g.some(h) || d?.some(h)) return fr(o, t);
		}
		return a ? f : pt.foldFlowLines(f, c, pt.FOLD_FLOW, Gn(t, !1));
	}
	function qk(e, t, r, n) {
		let { implicitKey: i, inFlow: o } = t,
			s = typeof e.value === 'string' ? e : Object.assign({}, e, { value: String(e.value) }),
			{ type: a } = e;
		if (a !== De.Scalar.QUOTE_DOUBLE) {
			if (/[\x00-\x08\x0b-\x1f\x7f-\x9f\u{D800}-\u{DFFF}]/u.test(s.value)) a = De.Scalar.QUOTE_DOUBLE;
		}
		let c = (l) => {
				switch (l) {
					case De.Scalar.BLOCK_FOLDED:
					case De.Scalar.BLOCK_LITERAL:
						return i || o ? fr(s.value, t) : Hn(s, t, r, n);
					case De.Scalar.QUOTE_DOUBLE:
						return Zr(s.value, t);
					case De.Scalar.QUOTE_SINGLE:
						return ns(s.value, t);
					case De.Scalar.PLAIN:
						return Nk(s, t, r, n);
					default:
						return null;
				}
			},
			u = c(a);
		if (u === null) {
			let { defaultKeyType: l, defaultStringType: f } = t.options, h = i && l || f;
			if (u = c(h), u === null) throw Error(`Unsupported default string type ${h}`);
		}
		return u;
	}
	Dk.stringifyString = qk;
});
var Ur = D(function(Kk) {
	var Fk = Un(), ht = W(), Rk = Br(), Bk = jr();
	function Zk(e, t) {
		let r = Object.assign(
				{
					blockQuote: !0,
					commentString: Rk.stringifyComment,
					defaultKeyType: null,
					defaultStringType: 'PLAIN',
					directives: null,
					doubleQuotedAsJSON: !1,
					doubleQuotedMinMultiLineLength: 40,
					falseStr: 'false',
					flowCollectionPadding: !0,
					indentSeq: !0,
					lineWidth: 80,
					minContentWidth: 20,
					nullStr: 'null',
					simpleKeys: !1,
					singleQuote: null,
					trailingComma: !1,
					trueStr: 'true',
					verifyAliasOrder: !0,
				},
				e.schema.toStringOptions,
				t,
			),
			n;
		switch (r.collectionStyle) {
			case 'block':
				n = !1;
				break;
			case 'flow':
				n = !0;
				break;
			default:
				n = null;
		}
		return {
			anchors: new Set(),
			doc: e,
			flowCollectionPadding: r.flowCollectionPadding ? ' ' : '',
			indent: '',
			indentStep: typeof r.indent === 'number' ? ' '.repeat(r.indent) : '  ',
			inFlow: n,
			options: r,
		};
	}
	function jk(e, t) {
		if (t.tag) {
			let i = e.filter((o) => o.tag === t.tag);
			if (i.length > 0) return i.find((o) => o.format === t.format) ?? i[0];
		}
		let r = void 0, n;
		if (ht.isScalar(t)) {
			n = t.value;
			let i = e.filter((o) => o.identify?.(n));
			if (i.length > 1) {
				let o = i.filter((s) => s.test);
				if (o.length > 0) i = o;
			}
			r = i.find((o) => o.format === t.format) ?? i.find((o) => !o.format);
		} else n = t, r = e.find((i) => i.nodeClass && n instanceof i.nodeClass);
		if (!r) {
			let i = n?.constructor?.name ?? (n === null ? 'null' : typeof n);
			throw Error(`Tag not resolved for ${i} value`);
		}
		return r;
	}
	function Uk(e, t, { anchors: r, doc: n }) {
		if (!n.directives) return '';
		let i = [], o = (ht.isScalar(e) || ht.isCollection(e)) && e.anchor;
		if (o && Fk.anchorIsValid(o)) r.add(o), i.push(`&${o}`);
		let s = e.tag ?? (t.default ? null : t.tag);
		if (s) i.push(n.directives.tagString(s));
		return i.join(' ');
	}
	function Vk(e, t, r, n) {
		if (ht.isPair(e)) return e.toString(t, r, n);
		if (ht.isAlias(e)) {
			if (t.doc.directives) return e.toString(t);
			if (t.resolvedAliases?.has(e)) throw TypeError('Cannot stringify circular structure without alias nodes');
			else {
				if (t.resolvedAliases) t.resolvedAliases.add(e);
				else t.resolvedAliases = new Set([e]);
				e = e.resolve(t.doc);
			}
		}
		let i = void 0, o = ht.isNode(e) ? e : t.doc.createNode(e, { onTagObj: (c) => i = c });
		i ?? (i = jk(t.doc.schema.tags, o));
		let s = Uk(o, i, t);
		if (s.length > 0) t.indentAtStart = (t.indentAtStart ?? 0) + s.length + 1;
		let a = typeof i.stringify === 'function'
			? i.stringify(o, t, r, n)
			: ht.isScalar(o)
			? Bk.stringifyString(o, t, r, n)
			: o.toString(t, r, n);
		if (!s) return a;
		return ht.isScalar(o) || a[0] === '{' || a[0] === '[' ? `${s} ${a}` : `${s}
${t.indent}${a}`;
	}
	Kk.createStringifyContext = Zk;
	Kk.stringify = Vk;
});
var _l = D(function(Wk) {
	var ot = W(), Sl = ce(), vl = Ur(), Vr = Br();
	function Gk({ key: e, value: t }, r, n, i) {
		let {
				allNullValues: o,
				doc: s,
				indent: a,
				indentStep: c,
				options: { commentString: u, indentSeq: l, simpleKeys: f },
			} = r,
			h = ot.isNode(e) && e.comment || null;
		if (f) {
			if (h) throw Error('With simple keys, key nodes cannot have comments');
			if (ot.isCollection(e) || !ot.isNode(e) && typeof e === 'object') {
				throw Error('With simple keys, collection cannot be used as a key value');
			}
		}
		let d = !f
			&& (!e || h && t == null && !r.inFlow || ot.isCollection(e)
				|| (ot.isScalar(e)
					? e.type === Sl.Scalar.BLOCK_FOLDED || e.type === Sl.Scalar.BLOCK_LITERAL
					: typeof e === 'object'));
		r = Object.assign({}, r, { allNullValues: !1, implicitKey: !d && (f || !o), indent: a + c });
		let g = !1, y = !1, x = vl.stringify(e, r, () => g = !0, () => y = !0);
		if (!d && !r.inFlow && x.length > 1024) {
			if (f) throw Error('With simple keys, single line scalar must not span more than 1024 characters');
			d = !0;
		}
		if (r.inFlow) {
			if (o || t == null) {
				if (g && n) n();
				return x === '' ? '?' : d ? `? ${x}` : x;
			}
		} else if (o && !f || t == null && d) {
			if (x = `? ${x}`, h && !g) x += Vr.lineComment(x, r.indent, u(h));
			else if (y && i) i();
			return x;
		}
		if (g) h = null;
		if (d) {
			if (h) x += Vr.lineComment(x, r.indent, u(h));
			x = `? ${x}
${a}:`;
		} else if (x = `${x}:`, h) x += Vr.lineComment(x, r.indent, u(h));
		let k, z, _;
		if (ot.isNode(t)) k = !!t.spaceBefore, z = t.commentBefore, _ = t.comment;
		else if (k = !1, z = null, _ = null, t && typeof t === 'object') t = s.createNode(t);
		if (r.implicitKey = !1, !d && !h && ot.isScalar(t)) r.indentAtStart = x.length + 1;
		if (y = !1, !l && c.length >= 2 && !r.inFlow && !d && ot.isSeq(t) && !t.flow && !t.tag && !t.anchor) {
			r.indent = r.indent.substring(2);
		}
		let O = !1, I = vl.stringify(t, r, () => O = !0, () => y = !0), v = ' ';
		if (h || k || z) {
			if (
				v = k
					? `
`
					: '', z
			) {
				let q = u(z);
				v += `
${Vr.indentComment(q, r.indent)}`;
			}
			if (I === '' && !r.inFlow) {
				if (
					v === `
` && _
				) {
					v = `

`;
				}
			} else {v += `
${r.indent}`;}
		} else if (!d && ot.isCollection(t)) {
			let q = I[0],
				L = I.indexOf(`
`),
				U = L !== -1,
				C = r.inFlow ?? t.flow ?? t.items.length === 0;
			if (U || !C) {
				let J = !1;
				if (U && (q === '&' || q === '!')) {
					let Z = I.indexOf(' ');
					if (q === '&' && Z !== -1 && Z < L && I[Z + 1] === '!') Z = I.indexOf(' ', Z + 1);
					if (Z === -1 || L < Z) J = !0;
				}
				if (!J) {
					v = `
${r.indent}`;
				}
			}
		} else if (
			I === '' || I[0] === `
`
		) v = '';
		if (x += v + I, r.inFlow) { if (O && n) n(); }
		else if (_ && !O) x += Vr.lineComment(x, r.indent, u(_));
		else if (y && i) i();
		return x;
	}
	Wk.stringifyPair = Gk;
});
var os = D(function(ew) {
	var Cl = ar('process');
	function Qk(e, ...t) {
		if (e === 'debug') console.log(...t);
	}
	function Xk(e, t) {
		if (e === 'debug' || e === 'warn') {
			if (typeof Cl.emitWarning === 'function') Cl.emitWarning(t);
			else console.warn(t);
		}
	}
	ew.debug = Qk;
	ew.warn = Xk;
});
var ei = D(function(iw) {
	var Xn = W(),
		zl = ce(),
		Yn = '<<',
		Qn = {
			identify: (e) => e === Yn || typeof e === 'symbol' && e.description === Yn,
			default: 'key',
			tag: 'tag:yaml.org,2002:merge',
			test: /^<<$/,
			resolve: () => Object.assign(new zl.Scalar(Symbol(Yn)), { addToJSMap: Tl }),
			stringify: () => Yn,
		},
		nw = (e, t) =>
			(Qn.identify(t) || Xn.isScalar(t) && (!t.type || t.type === zl.Scalar.PLAIN) && Qn.identify(t.value))
			&& e?.doc.schema.tags.some((r) => r.tag === Qn.tag && r.default);
	function Tl(e, t, r) {
		let n = Al(e, r);
		if (Xn.isSeq(n)) { for (let i of n.items) ss(e, t, i); }
		else if (Array.isArray(n)) { for (let i of n) ss(e, t, i); }
		else ss(e, t, n);
	}
	function ss(e, t, r) {
		let n = Al(e, r);
		if (!Xn.isMap(n)) throw Error('Merge sources must be maps or map aliases');
		let i = n.toJSON(null, e, Map);
		for (let [o, s] of i) {
			if (t instanceof Map) { if (!t.has(o)) t.set(o, s); }
			else if (t instanceof Set) t.add(o);
			else if (!Object.prototype.hasOwnProperty.call(t, o)) {
				Object.defineProperty(t, o, { value: s, writable: !0, enumerable: !0, configurable: !0 });
			}
		}
		return t;
	}
	function Al(e, t) {
		return e && Xn.isAlias(t) ? t.resolve(e.doc, e) : t;
	}
	iw.addMergeToJSMap = Tl;
	iw.isMergeKey = nw;
	iw.merge = Qn;
});
var cs = D(function(pw) {
	var cw = os(), El = ei(), uw = Ur(), Il = W(), as = ft();
	function lw(e, t, { key: r, value: n }) {
		if (Il.isNode(r) && r.addToJSMap) r.addToJSMap(e, t, n);
		else if (El.isMergeKey(e, r)) El.addMergeToJSMap(e, t, n);
		else {
			let i = as.toJS(r, '', e);
			if (t instanceof Map) t.set(i, as.toJS(n, i, e));
			else if (t instanceof Set) t.add(i);
			else {
				let o = fw(r, i, e), s = as.toJS(n, o, e);
				if (o in t) Object.defineProperty(t, o, { value: s, writable: !0, enumerable: !0, configurable: !0 });
				else t[o] = s;
			}
		}
		return t;
	}
	function fw(e, t, r) {
		if (t === null) return '';
		if (typeof t !== 'object') return String(t);
		if (Il.isNode(e) && r?.doc) {
			let n = uw.createStringifyContext(r.doc, {});
			n.anchors = new Set();
			for (let o of r.anchors.keys()) n.anchors.add(o.anchor);
			n.inFlow = !0, n.inStringifyKey = !0;
			let i = e.toString(n);
			if (!r.mapKeyWarned) {
				let o = JSON.stringify(i);
				if (o.length > 40) o = o.substring(0, 36) + '..."';
				cw.warn(
					r.doc.options.logLevel,
					`Keys with collection values will be stringified due to JS Object restrictions: ${o}. Set mapAsMap: true to use object keys.`,
				), r.mapKeyWarned = !0;
			}
			return i;
		}
		return JSON.stringify(t);
	}
	pw.addPairToJSMap = lw;
});
var dt = D(function(yw) {
	var Pl = Rr(), dw = _l(), mw = cs(), ti = W();
	function gw(e, t, r) {
		let n = Pl.createNode(e, void 0, r), i = Pl.createNode(t, void 0, r);
		return new ri(n, i);
	}
	class ri {
		constructor(e, t = null) {
			Object.defineProperty(this, ti.NODE_TYPE, { value: ti.PAIR }), this.key = e, this.value = t;
		}
		clone(e) {
			let { key: t, value: r } = this;
			if (ti.isNode(t)) t = t.clone(e);
			if (ti.isNode(r)) r = r.clone(e);
			return new ri(t, r);
		}
		toJSON(e, t) {
			let r = t?.mapAsMap ? new Map() : {};
			return mw.addPairToJSMap(t, r, this);
		}
		toString(e, t, r) {
			return e?.doc ? dw.stringifyPair(this, e, t, r) : JSON.stringify(this);
		}
	}
	yw.Pair = ri;
	yw.createPair = gw;
});
var us = D(function(vw) {
	var qt = W(), Ol = Ur(), ni = Br();
	function kw(e, t, r) {
		return (t.inFlow ?? e.flow ? Sw : ww)(e, t, r);
	}
	function ww(
		{ comment: e, items: t },
		r,
		{ blockItemPrefix: n, flowChars: i, itemIndent: o, onChompKeep: s, onComment: a },
	) {
		let { indent: c, options: { commentString: u } } = r,
			l = Object.assign({}, r, { indent: o, type: null }),
			f = !1,
			h = [];
		for (let g = 0; g < t.length; ++g) {
			let y = t[g], x = null;
			if (qt.isNode(y)) {
				if (!f && y.spaceBefore) h.push('');
				if (ii(r, h, y.commentBefore, f), y.comment) x = y.comment;
			} else if (qt.isPair(y)) {
				let z = qt.isNode(y.key) ? y.key : null;
				if (z) {
					if (!f && z.spaceBefore) h.push('');
					ii(r, h, z.commentBefore, f);
				}
			}
			f = !1;
			let k = Ol.stringify(y, l, () => x = null, () => f = !0);
			if (x) k += ni.lineComment(k, o, u(x));
			if (f && x) f = !1;
			h.push(n + k);
		}
		let d;
		if (h.length === 0) d = i.start + i.end;
		else {
			d = h[0];
			for (let g = 1; g < h.length; ++g) {
				let y = h[g];
				d += y
					? `
${c}${y}`
					: `
`;
			}
		}
		if (e) {
			if (
				d += `
` + ni.indentComment(u(e), c), a
			) a();
		} else if (f && s) s();
		return d;
	}
	function Sw({ items: e }, t, { flowChars: r, itemIndent: n }) {
		let { indent: i, indentStep: o, flowCollectionPadding: s, options: { commentString: a } } = t;
		n += o;
		let c = Object.assign({}, t, { indent: n, inFlow: !0, type: null }), u = !1, l = 0, f = [];
		for (let g = 0; g < e.length; ++g) {
			let y = e[g], x = null;
			if (qt.isNode(y)) {
				if (y.spaceBefore) f.push('');
				if (ii(t, f, y.commentBefore, !1), y.comment) x = y.comment;
			} else if (qt.isPair(y)) {
				let z = qt.isNode(y.key) ? y.key : null;
				if (z) {
					if (z.spaceBefore) f.push('');
					if (ii(t, f, z.commentBefore, !1), z.comment) u = !0;
				}
				let _ = qt.isNode(y.value) ? y.value : null;
				if (_) {
					if (_.comment) x = _.comment;
					if (_.commentBefore) u = !0;
				} else if (y.value == null && z?.comment) x = z.comment;
			}
			if (x) u = !0;
			let k = Ol.stringify(y, c, () => x = null);
			if (
				u || (u = f.length > l || k.includes(`
`)), g < e.length - 1
			) k += ',';
			else if (t.options.trailingComma) {
				if (t.options.lineWidth > 0) {
					u || (u = f.reduce((z, _) => z + _.length + 2, 2) + (k.length + 2) > t.options.lineWidth);
				}
				if (u) k += ',';
			}
			if (x) k += ni.lineComment(k, n, a(x));
			f.push(k), l = f.length;
		}
		let { start: h, end: d } = r;
		if (f.length === 0) return h + d;
		else {
			if (!u) {
				let g = f.reduce((y, x) => y + x.length + 2, 2);
				u = t.options.lineWidth > 0 && g > t.options.lineWidth;
			}
			if (u) {
				let g = h;
				for (let y of f) {
					g += y
						? `
${o}${i}${y}`
						: `
`;
				}
				return `${g}
${i}${d}`;
			} else return `${h}${s}${f.join(' ')}${s}${d}`;
		}
	}
	function ii({ indent: e, options: { commentString: t } }, r, n, i) {
		if (n && i) n = n.replace(/^\n+/, '');
		if (n) {
			let o = ni.indentComment(t(n), e);
			r.push(o.trimStart());
		}
	}
	vw.stringifyCollection = kw;
});
var gt = D(function(Ew) {
	var Cw = us(), zw = cs(), Tw = Jn(), mt = W(), oi = dt(), Aw = ce();
	function Kr(e, t) {
		let r = mt.isScalar(t) ? t.value : t;
		for (let n of e) {
			if (mt.isPair(n)) {
				if (n.key === t || n.key === r) return n;
				if (mt.isScalar(n.key) && n.key.value === r) return n;
			}
		}
		return;
	}
	class $l extends Tw.Collection {
		static get tagName() {
			return 'tag:yaml.org,2002:map';
		}
		constructor(e) {
			super(mt.MAP, e);
			this.items = [];
		}
		static from(e, t, r) {
			let { keepUndefined: n, replacer: i } = r,
				o = new this(e),
				s = (a, c) => {
					if (typeof i === 'function') c = i.call(t, a, c);
					else if (Array.isArray(i) && !i.includes(a)) return;
					if (c !== void 0 || n) o.items.push(oi.createPair(a, c, r));
				};
			if (t instanceof Map) { for (let [a, c] of t) s(a, c); }
			else if (t && typeof t === 'object') { for (let a of Object.keys(t)) s(a, t[a]); }
			if (typeof e.sortMapEntries === 'function') o.items.sort(e.sortMapEntries);
			return o;
		}
		add(e, t) {
			let r;
			if (mt.isPair(e)) r = e;
			else if (!e || typeof e !== 'object' || !('key' in e)) r = new oi.Pair(e, e?.value);
			else r = new oi.Pair(e.key, e.value);
			let n = Kr(this.items, r.key), i = this.schema?.sortMapEntries;
			if (n) {
				if (!t) throw Error(`Key ${r.key} already set`);
				if (mt.isScalar(n.value) && Aw.isScalarValue(r.value)) n.value.value = r.value;
				else n.value = r.value;
			} else if (i) {
				let o = this.items.findIndex((s) => i(r, s) < 0);
				if (o === -1) this.items.push(r);
				else this.items.splice(o, 0, r);
			} else this.items.push(r);
		}
		delete(e) {
			let t = Kr(this.items, e);
			if (!t) return !1;
			return this.items.splice(this.items.indexOf(t), 1).length > 0;
		}
		get(e, t) {
			let n = Kr(this.items, e)?.value;
			return (!t && mt.isScalar(n) ? n.value : n) ?? void 0;
		}
		has(e) {
			return !!Kr(this.items, e);
		}
		set(e, t) {
			this.add(new oi.Pair(e, t), !0);
		}
		toJSON(e, t, r) {
			let n = r ? new r() : t?.mapAsMap ? new Map() : {};
			if (t?.onCreate) t.onCreate(n);
			for (let i of this.items) zw.addPairToJSMap(t, n, i);
			return n;
		}
		toString(e, t, r) {
			if (!e) return JSON.stringify(this);
			for (let n of this.items) {
				if (!mt.isPair(n)) throw Error(`Map items must all be pairs; found ${JSON.stringify(n)} instead`);
			}
			if (!e.allNullValues && this.hasAllNullValues(!1)) e = Object.assign({}, e, { allNullValues: !0 });
			return Cw.stringifyCollection(this, e, {
				blockItemPrefix: '',
				flowChars: { start: '{', end: '}' },
				itemIndent: e.indent || '',
				onChompKeep: r,
				onComment: t,
			});
		}
	}
	Ew.YAMLMap = $l;
	Ew.findPair = Kr;
});
var pr = D(function(Lw) {
	var Ow = W(),
		Ll = gt(),
		$w = {
			collection: 'map',
			default: !0,
			nodeClass: Ll.YAMLMap,
			tag: 'tag:yaml.org,2002:map',
			resolve(e, t) {
				if (!Ow.isMap(e)) t('Expected a mapping for this tag');
				return e;
			},
			createNode: (e, t, r) => Ll.YAMLMap.from(e, t, r),
		};
	Lw.map = $w;
});
var yt = D(function(Bw) {
	var qw = Rr(), Dw = us(), Mw = Jn(), ai = W(), Fw = ce(), Rw = ft();
	class Nl extends Mw.Collection {
		static get tagName() {
			return 'tag:yaml.org,2002:seq';
		}
		constructor(e) {
			super(ai.SEQ, e);
			this.items = [];
		}
		add(e) {
			this.items.push(e);
		}
		delete(e) {
			let t = si(e);
			if (typeof t !== 'number') return !1;
			return this.items.splice(t, 1).length > 0;
		}
		get(e, t) {
			let r = si(e);
			if (typeof r !== 'number') return;
			let n = this.items[r];
			return !t && ai.isScalar(n) ? n.value : n;
		}
		has(e) {
			let t = si(e);
			return typeof t === 'number' && t < this.items.length;
		}
		set(e, t) {
			let r = si(e);
			if (typeof r !== 'number') throw Error(`Expected a valid index, not ${e}.`);
			let n = this.items[r];
			if (ai.isScalar(n) && Fw.isScalarValue(t)) n.value = t;
			else this.items[r] = t;
		}
		toJSON(e, t) {
			let r = [];
			if (t?.onCreate) t.onCreate(r);
			let n = 0;
			for (let i of this.items) r.push(Rw.toJS(i, String(n++), t));
			return r;
		}
		toString(e, t, r) {
			if (!e) return JSON.stringify(this);
			return Dw.stringifyCollection(this, e, {
				blockItemPrefix: '- ',
				flowChars: { start: '[', end: ']' },
				itemIndent: (e.indent || '') + '  ',
				onChompKeep: r,
				onComment: t,
			});
		}
		static from(e, t, r) {
			let { replacer: n } = r, i = new this(e);
			if (t && Symbol.iterator in Object(t)) {
				let o = 0;
				for (let s of t) {
					if (typeof n === 'function') {
						let a = t instanceof Set ? s : String(o++);
						s = n.call(t, a, s);
					}
					i.items.push(qw.createNode(s, void 0, r));
				}
			}
			return i;
		}
	}
	function si(e) {
		let t = ai.isScalar(e) ? e.value : e;
		if (t && typeof t === 'string') t = Number(t);
		return typeof t === 'number' && Number.isInteger(t) && t >= 0 ? t : null;
	}
	Bw.YAMLSeq = Nl;
});
var hr = D(function(Vw) {
	var jw = W(),
		ql = yt(),
		Uw = {
			collection: 'seq',
			default: !0,
			nodeClass: ql.YAMLSeq,
			tag: 'tag:yaml.org,2002:seq',
			resolve(e, t) {
				if (!jw.isSeq(e)) t('Expected a sequence for this tag');
				return e;
			},
			createNode: (e, t, r) => ql.YAMLSeq.from(e, t, r),
		};
	Vw.seq = Uw;
});
var Jr = D(function(Gw) {
	var Jw = jr(),
		Hw = {
			identify: (e) => typeof e === 'string',
			default: !0,
			tag: 'tag:yaml.org,2002:str',
			resolve: (e) => e,
			stringify(e, t, r, n) {
				return t = Object.assign({ actualString: !0 }, t), Jw.stringifyString(e, t, r, n);
			},
		};
	Gw.string = Hw;
});
var ci = D(function(Yw) {
	var Dl = ce(),
		Ml = {
			identify: (e) => e == null,
			createNode: () => new Dl.Scalar(null),
			default: !0,
			tag: 'tag:yaml.org,2002:null',
			test: /^(?:~|[Nn]ull|NULL)?$/,
			resolve: () => new Dl.Scalar(null),
			stringify: ({ source: e }, t) => typeof e === 'string' && Ml.test.test(e) ? e : t.options.nullStr,
		};
	Yw.nullTag = Ml;
});
var ls = D(function(eS) {
	var Xw = ce(),
		Fl = {
			identify: (e) => typeof e === 'boolean',
			default: !0,
			tag: 'tag:yaml.org,2002:bool',
			test: /^(?:[Tt]rue|TRUE|[Ff]alse|FALSE)$/,
			resolve: (e) => new Xw.Scalar(e[0] === 't' || e[0] === 'T'),
			stringify({ source: e, value: t }, r) {
				if (e && Fl.test.test(e)) {
					let n = e[0] === 't' || e[0] === 'T';
					if (t === n) return e;
				}
				return t ? r.options.trueStr : r.options.falseStr;
			},
		};
	eS.boolTag = Fl;
});
var dr = D(function(nS) {
	function rS({ format: e, minFractionDigits: t, tag: r, value: n }) {
		if (typeof n === 'bigint') return String(n);
		let i = typeof n === 'number' ? n : Number(n);
		if (!isFinite(i)) return isNaN(i) ? '.nan' : i < 0 ? '-.inf' : '.inf';
		let o = Object.is(n, -0) ? '-0' : JSON.stringify(n);
		if (!e && t && (!r || r === 'tag:yaml.org,2002:float') && /^-?\d/.test(o) && !o.includes('e')) {
			let s = o.indexOf('.');
			if (s < 0) s = o.length, o += '.';
			let a = t - (o.length - s - 1);
			while (a-- > 0) o += '0';
		}
		return o;
	}
	nS.stringifyNumber = rS;
});
var ps = D(function(uS) {
	var oS = ce(),
		fs = dr(),
		sS = {
			identify: (e) => typeof e === 'number',
			default: !0,
			tag: 'tag:yaml.org,2002:float',
			test: /^(?:[-+]?\.(?:inf|Inf|INF)|\.nan|\.NaN|\.NAN)$/,
			resolve: (e) =>
				e.slice(-3).toLowerCase() === 'nan' ? NaN : e[0] === '-' ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY,
			stringify: fs.stringifyNumber,
		},
		aS = {
			identify: (e) => typeof e === 'number',
			default: !0,
			tag: 'tag:yaml.org,2002:float',
			format: 'EXP',
			test: /^[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)[eE][-+]?[0-9]+$/,
			resolve: (e) => parseFloat(e),
			stringify(e) {
				let t = Number(e.value);
				return isFinite(t) ? t.toExponential() : fs.stringifyNumber(e);
			},
		},
		cS = {
			identify: (e) => typeof e === 'number',
			default: !0,
			tag: 'tag:yaml.org,2002:float',
			test: /^[-+]?(?:\.[0-9]+|[0-9]+\.[0-9]*)$/,
			resolve(e) {
				let t = new oS.Scalar(parseFloat(e)), r = e.indexOf('.');
				if (r !== -1 && e[e.length - 1] === '0') t.minFractionDigits = e.length - r - 1;
				return t;
			},
			stringify: fs.stringifyNumber,
		};
	uS.float = cS;
	uS.floatExp = aS;
	uS.floatNaN = sS;
});
var ds = D(function(gS) {
	var Rl = dr(),
		ui = (e) => typeof e === 'bigint' || Number.isInteger(e),
		hs = (e, t, r, { intAsBigInt: n }) => n ? BigInt(e) : parseInt(e.substring(t), r);
	function Bl(e, t, r) {
		let { value: n } = e;
		if (ui(n) && n >= 0) return r + n.toString(t);
		return Rl.stringifyNumber(e);
	}
	var hS = {
			identify: (e) => ui(e) && e >= 0,
			default: !0,
			tag: 'tag:yaml.org,2002:int',
			format: 'OCT',
			test: /^0o[0-7]+$/,
			resolve: (e, t, r) => hs(e, 2, 8, r),
			stringify: (e) => Bl(e, 8, '0o'),
		},
		dS = {
			identify: ui,
			default: !0,
			tag: 'tag:yaml.org,2002:int',
			test: /^[-+]?[0-9]+$/,
			resolve: (e, t, r) => hs(e, 0, 10, r),
			stringify: Rl.stringifyNumber,
		},
		mS = {
			identify: (e) => ui(e) && e >= 0,
			default: !0,
			tag: 'tag:yaml.org,2002:int',
			format: 'HEX',
			test: /^0x[0-9a-fA-F]+$/,
			resolve: (e, t, r) => hs(e, 2, 16, r),
			stringify: (e) => Bl(e, 16, '0x'),
		};
	gS.int = dS;
	gS.intHex = mS;
	gS.intOct = hS;
});
var Zl = D(function(zS) {
	var kS = pr(),
		wS = ci(),
		SS = hr(),
		vS = Jr(),
		_S = ls(),
		ms = ps(),
		gs = ds(),
		CS = [
			kS.map,
			SS.seq,
			vS.string,
			wS.nullTag,
			_S.boolTag,
			gs.intOct,
			gs.int,
			gs.intHex,
			ms.floatNaN,
			ms.floatExp,
			ms.float,
		];
	zS.schema = CS;
});
var Ul = D(function(LS) {
	var AS = ce(), ES = pr(), IS = hr();
	function jl(e) {
		return typeof e === 'bigint' || Number.isInteger(e);
	}
	var li = ({ value: e }) => JSON.stringify(e),
		PS = [{
			identify: (e) => typeof e === 'string',
			default: !0,
			tag: 'tag:yaml.org,2002:str',
			resolve: (e) => e,
			stringify: li,
		}, {
			identify: (e) => e == null,
			createNode: () => new AS.Scalar(null),
			default: !0,
			tag: 'tag:yaml.org,2002:null',
			test: /^null$/,
			resolve: () => null,
			stringify: li,
		}, {
			identify: (e) => typeof e === 'boolean',
			default: !0,
			tag: 'tag:yaml.org,2002:bool',
			test: /^true$|^false$/,
			resolve: (e) => e === 'true',
			stringify: li,
		}, {
			identify: jl,
			default: !0,
			tag: 'tag:yaml.org,2002:int',
			test: /^-?(?:0|[1-9][0-9]*)$/,
			resolve: (e, t, { intAsBigInt: r }) => r ? BigInt(e) : parseInt(e, 10),
			stringify: ({ value: e }) => jl(e) ? e.toString() : JSON.stringify(e),
		}, {
			identify: (e) => typeof e === 'number',
			default: !0,
			tag: 'tag:yaml.org,2002:float',
			test: /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]*)?(?:[eE][-+]?[0-9]+)?$/,
			resolve: (e) => parseFloat(e),
			stringify: li,
		}],
		OS = {
			default: !0,
			tag: '',
			test: /^/,
			resolve(e, t) {
				return t(`Unresolved plain scalar ${JSON.stringify(e)}`), e;
			},
		},
		$S = [ES.map, IS.seq].concat(PS, OS);
	LS.schema = $S;
});
var bs = D(function(MS) {
	var Hr = ar('buffer'),
		ys = ce(),
		qS = jr(),
		DS = {
			identify: (e) => e instanceof Uint8Array,
			default: !1,
			tag: 'tag:yaml.org,2002:binary',
			resolve(e, t) {
				if (typeof Hr.Buffer === 'function') return Hr.Buffer.from(e, 'base64');
				else if (typeof atob === 'function') {
					let r = atob(e.replace(/[\n\r]/g, '')), n = new Uint8Array(r.length);
					for (let i = 0; i < r.length; ++i) n[i] = r.charCodeAt(i);
					return n;
				} else return t('This environment does not support reading binary tags; either Buffer or atob is required'), e;
			},
			stringify({ comment: e, type: t, value: r }, n, i, o) {
				if (!r) return '';
				let s = r, a;
				if (typeof Hr.Buffer === 'function') {
					a = s instanceof Hr.Buffer
						? s.toString('base64')
						: Hr.Buffer.from(s.buffer).toString('base64');
				} else if (typeof btoa === 'function') {
					let c = '';
					for (let u = 0; u < s.length; ++u) c += String.fromCharCode(s[u]);
					a = btoa(c);
				} else throw Error('This environment does not support writing binary tags; either Buffer or btoa is required');
				if (t ?? (t = ys.Scalar.BLOCK_LITERAL), t !== ys.Scalar.QUOTE_DOUBLE) {
					let c = Math.max(n.options.lineWidth - n.indent.length, n.options.minContentWidth),
						u = Math.ceil(a.length / c),
						l = Array(u);
					for (let f = 0, h = 0; f < u; ++f, h += c) l[f] = a.substr(h, c);
					a = l.join(
						t === ys.Scalar.BLOCK_LITERAL
							? `
`
							: ' ',
					);
				}
				return qS.stringifyString({ comment: e, type: t, value: a }, n, i, o);
			},
		};
	MS.binary = DS;
});
var pi = D(function(jS) {
	var fi = W(), xs = dt(), RS = ce(), BS = yt();
	function Vl(e, t) {
		if (fi.isSeq(e)) {
			for (let r = 0; r < e.items.length; ++r) {
				let n = e.items[r];
				if (fi.isPair(n)) continue;
				else if (fi.isMap(n)) {
					if (n.items.length > 1) t('Each pair must have its own sequence indicator');
					let i = n.items[0] || new xs.Pair(new RS.Scalar(null));
					if (n.commentBefore) {
						i.key.commentBefore = i.key.commentBefore
							? `${n.commentBefore}
${i.key.commentBefore}`
							: n.commentBefore;
					}
					if (n.comment) {
						let o = i.value ?? i.key;
						o.comment = o.comment
							? `${n.comment}
${o.comment}`
							: n.comment;
					}
					n = i;
				}
				e.items[r] = fi.isPair(n) ? n : new xs.Pair(n);
			}
		} else t('Expected a sequence for this tag');
		return e;
	}
	function Kl(e, t, r) {
		let { replacer: n } = r, i = new BS.YAMLSeq(e);
		i.tag = 'tag:yaml.org,2002:pairs';
		let o = 0;
		if (t && Symbol.iterator in Object(t)) {
			for (let s of t) {
				if (typeof n === 'function') s = n.call(t, String(o++), s);
				let a, c;
				if (Array.isArray(s)) {
					if (s.length === 2) a = s[0], c = s[1];
					else throw TypeError(`Expected [key, value] tuple: ${s}`);
				} else if (s && s instanceof Object) {
					let u = Object.keys(s);
					if (u.length === 1) a = u[0], c = s[a];
					else throw TypeError(`Expected tuple with one key, not ${u.length} keys`);
				} else a = s;
				i.items.push(xs.createPair(a, c, r));
			}
		}
		return i;
	}
	var ZS = { collection: 'seq', default: !1, tag: 'tag:yaml.org,2002:pairs', resolve: Vl, createNode: Kl };
	jS.createPairs = Kl;
	jS.pairs = ZS;
	jS.resolvePairs = Vl;
});
var ws = D(function(GS) {
	var Jl = W(), ks = ft(), Gr = gt(), JS = yt(), Hl = pi();
	class Dt extends JS.YAMLSeq {
		constructor() {
			super();
			this.add = Gr.YAMLMap.prototype.add.bind(this),
				this.delete = Gr.YAMLMap.prototype.delete.bind(this),
				this.get = Gr.YAMLMap.prototype.get.bind(this),
				this.has = Gr.YAMLMap.prototype.has.bind(this),
				this.set = Gr.YAMLMap.prototype.set.bind(this),
				this.tag = Dt.tag;
		}
		toJSON(e, t) {
			if (!t) return super.toJSON(e);
			let r = new Map();
			if (t?.onCreate) t.onCreate(r);
			for (let n of this.items) {
				let i, o;
				if (Jl.isPair(n)) i = ks.toJS(n.key, '', t), o = ks.toJS(n.value, i, t);
				else i = ks.toJS(n, '', t);
				if (r.has(i)) throw Error('Ordered maps must not include duplicate keys');
				r.set(i, o);
			}
			return r;
		}
		static from(e, t, r) {
			let n = Hl.createPairs(e, t, r), i = new this();
			return i.items = n.items, i;
		}
	}
	Dt.tag = 'tag:yaml.org,2002:omap';
	var HS = {
		collection: 'seq',
		identify: (e) => e instanceof Map,
		nodeClass: Dt,
		default: !1,
		tag: 'tag:yaml.org,2002:omap',
		resolve(e, t) {
			let r = Hl.resolvePairs(e, t), n = [];
			for (let { key: i } of r.items) {
				if (Jl.isScalar(i)) {
					if (n.includes(i.value)) t(`Ordered maps must not include duplicate keys: ${i.value}`);
					else n.push(i.value);
				}
			}
			return Object.assign(new Dt(), r);
		},
		createNode: (e, t, r) => Dt.from(e, t, r),
	};
	GS.YAMLOMap = Dt;
	GS.omap = HS;
});
var Xl = D(function(QS) {
	var Gl = ce();
	function Wl({ value: e, source: t }, r) {
		if (t && (e ? Yl : Ql).test.test(t)) return t;
		return e ? r.options.trueStr : r.options.falseStr;
	}
	var Yl = {
			identify: (e) => e === !0,
			default: !0,
			tag: 'tag:yaml.org,2002:bool',
			test: /^(?:Y|y|[Yy]es|YES|[Tt]rue|TRUE|[Oo]n|ON)$/,
			resolve: () => new Gl.Scalar(!0),
			stringify: Wl,
		},
		Ql = {
			identify: (e) => e === !1,
			default: !0,
			tag: 'tag:yaml.org,2002:bool',
			test: /^(?:N|n|[Nn]o|NO|[Ff]alse|FALSE|[Oo]ff|OFF)$/,
			resolve: () => new Gl.Scalar(!1),
			stringify: Wl,
		};
	QS.falseTag = Ql;
	QS.trueTag = Yl;
});
var ef = D(function(ov) {
	var tv = ce(),
		Ss = dr(),
		rv = {
			identify: (e) => typeof e === 'number',
			default: !0,
			tag: 'tag:yaml.org,2002:float',
			test: /^(?:[-+]?\.(?:inf|Inf|INF)|\.nan|\.NaN|\.NAN)$/,
			resolve: (e) =>
				e.slice(-3).toLowerCase() === 'nan' ? NaN : e[0] === '-' ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY,
			stringify: Ss.stringifyNumber,
		},
		nv = {
			identify: (e) => typeof e === 'number',
			default: !0,
			tag: 'tag:yaml.org,2002:float',
			format: 'EXP',
			test: /^[-+]?(?:[0-9][0-9_]*)?(?:\.[0-9_]*)?[eE][-+]?[0-9]+$/,
			resolve: (e) => parseFloat(e.replace(/_/g, '')),
			stringify(e) {
				let t = Number(e.value);
				return isFinite(t) ? t.toExponential() : Ss.stringifyNumber(e);
			},
		},
		iv = {
			identify: (e) => typeof e === 'number',
			default: !0,
			tag: 'tag:yaml.org,2002:float',
			test: /^[-+]?(?:[0-9][0-9_]*)?\.[0-9_]*$/,
			resolve(e) {
				let t = new tv.Scalar(parseFloat(e.replace(/_/g, ''))), r = e.indexOf('.');
				if (r !== -1) {
					let n = e.substring(r + 1).replace(/_/g, '');
					if (n[n.length - 1] === '0') t.minFractionDigits = n.length;
				}
				return t;
			},
			stringify: Ss.stringifyNumber,
		};
	ov.float = iv;
	ov.floatExp = nv;
	ov.floatNaN = rv;
});
var rf = D(function(hv) {
	var tf = dr(), Wr = (e) => typeof e === 'bigint' || Number.isInteger(e);
	function hi(e, t, r, { intAsBigInt: n }) {
		let i = e[0];
		if (i === '-' || i === '+') t += 1;
		if (e = e.substring(t).replace(/_/g, ''), n) {
			switch (r) {
				case 2:
					e = `0b${e}`;
					break;
				case 8:
					e = `0o${e}`;
					break;
				case 16:
					e = `0x${e}`;
					break;
			}
			let s = BigInt(e);
			return i === '-' ? BigInt(-1) * s : s;
		}
		let o = parseInt(e, r);
		return i === '-' ? -1 * o : o;
	}
	function vs(e, t, r) {
		let { value: n } = e;
		if (Wr(n)) {
			let i = n.toString(t);
			return n < 0 ? '-' + r + i.substr(1) : r + i;
		}
		return tf.stringifyNumber(e);
	}
	var uv = {
			identify: Wr,
			default: !0,
			tag: 'tag:yaml.org,2002:int',
			format: 'BIN',
			test: /^[-+]?0b[0-1_]+$/,
			resolve: (e, t, r) => hi(e, 2, 2, r),
			stringify: (e) => vs(e, 2, '0b'),
		},
		lv = {
			identify: Wr,
			default: !0,
			tag: 'tag:yaml.org,2002:int',
			format: 'OCT',
			test: /^[-+]?0[0-7_]+$/,
			resolve: (e, t, r) => hi(e, 1, 8, r),
			stringify: (e) => vs(e, 8, '0'),
		},
		fv = {
			identify: Wr,
			default: !0,
			tag: 'tag:yaml.org,2002:int',
			test: /^[-+]?[0-9][0-9_]*$/,
			resolve: (e, t, r) => hi(e, 0, 10, r),
			stringify: tf.stringifyNumber,
		},
		pv = {
			identify: Wr,
			default: !0,
			tag: 'tag:yaml.org,2002:int',
			format: 'HEX',
			test: /^[-+]?0x[0-9a-fA-F_]+$/,
			resolve: (e, t, r) => hi(e, 2, 16, r),
			stringify: (e) => vs(e, 16, '0x'),
		};
	hv.int = fv;
	hv.intBin = uv;
	hv.intHex = pv;
	hv.intOct = lv;
});
var _s = D(function(xv) {
	var gi = W(), di = dt(), mi = gt();
	class Mt extends mi.YAMLMap {
		constructor(e) {
			super(e);
			this.tag = Mt.tag;
		}
		add(e) {
			let t;
			if (gi.isPair(e)) t = e;
			else if (e && typeof e === 'object' && 'key' in e && 'value' in e && e.value === null) {
				t = new di.Pair(e.key, null);
			} else t = new di.Pair(e, null);
			if (!mi.findPair(this.items, t.key)) this.items.push(t);
		}
		get(e, t) {
			let r = mi.findPair(this.items, e);
			return !t && gi.isPair(r) ? gi.isScalar(r.key) ? r.key.value : r.key : r;
		}
		set(e, t) {
			if (typeof t !== 'boolean') {
				throw Error(`Expected boolean value for set(key, value) in a YAML set, not ${typeof t}`);
			}
			let r = mi.findPair(this.items, e);
			if (r && !t) this.items.splice(this.items.indexOf(r), 1);
			else if (!r && t) this.items.push(new di.Pair(e));
		}
		toJSON(e, t) {
			return super.toJSON(e, t, Set);
		}
		toString(e, t, r) {
			if (!e) return JSON.stringify(this);
			if (this.hasAllNullValues(!0)) return super.toString(Object.assign({}, e, { allNullValues: !0 }), t, r);
			else throw Error('Set items must all have null values');
		}
		static from(e, t, r) {
			let { replacer: n } = r, i = new this(e);
			if (t && Symbol.iterator in Object(t)) {
				for (let o of t) {
					if (typeof n === 'function') o = n.call(t, o, o);
					i.items.push(di.createPair(o, null, r));
				}
			}
			return i;
		}
	}
	Mt.tag = 'tag:yaml.org,2002:set';
	var bv = {
		collection: 'map',
		identify: (e) => e instanceof Set,
		nodeClass: Mt,
		default: !1,
		tag: 'tag:yaml.org,2002:set',
		createNode: (e, t, r) => Mt.from(e, t, r),
		resolve(e, t) {
			if (gi.isMap(e)) {
				if (e.hasAllNullValues(!0)) return Object.assign(new Mt(), e);
				else t('Set items must all have null values');
			} else t('Expected a mapping for this tag');
			return e;
		},
	};
	xv.YAMLSet = Mt;
	xv.set = bv;
});
var zs = D(function(Cv) {
	var Sv = dr();
	function Cs(e, t) {
		let r = e[0],
			n = r === '-' || r === '+' ? e.substring(1) : e,
			i = (s) => t ? BigInt(s) : Number(s),
			o = n.replace(/_/g, '').split(':').reduce((s, a) => s * i(60) + i(a), i(0));
		return r === '-' ? i(-1) * o : o;
	}
	function nf(e) {
		let { value: t } = e, r = (s) => s;
		if (typeof t === 'bigint') r = (s) => BigInt(s);
		else if (isNaN(t) || !isFinite(t)) return Sv.stringifyNumber(e);
		let n = '';
		if (t < 0) n = '-', t *= r(-1);
		let i = r(60), o = [t % i];
		if (t < 60) o.unshift(0);
		else if (t = (t - o[0]) / i, o.unshift(t % i), t >= 60) t = (t - o[0]) / i, o.unshift(t);
		return n + o.map((s) => String(s).padStart(2, '0')).join(':').replace(/000000\d*$/, '');
	}
	var vv = {
			identify: (e) => typeof e === 'bigint' || Number.isInteger(e),
			default: !0,
			tag: 'tag:yaml.org,2002:int',
			format: 'TIME',
			test: /^[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+$/,
			resolve: (e, t, { intAsBigInt: r }) => Cs(e, r),
			stringify: nf,
		},
		_v = {
			identify: (e) => typeof e === 'number',
			default: !0,
			tag: 'tag:yaml.org,2002:float',
			format: 'TIME',
			test: /^[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+\.[0-9_]*$/,
			resolve: (e) => Cs(e, !1),
			stringify: nf,
		},
		of = {
			identify: (e) => e instanceof Date,
			default: !0,
			tag: 'tag:yaml.org,2002:timestamp',
			test: RegExp(
				'^([0-9]{4})-([0-9]{1,2})-([0-9]{1,2})(?:(?:t|T|[ \\t]+)([0-9]{1,2}):([0-9]{1,2}):([0-9]{1,2}(\\.[0-9]+)?)(?:[ \\t]*(Z|[-+][012]?[0-9](?::[0-9]{2})?))?)?$',
			),
			resolve(e) {
				let t = e.match(of.test);
				if (!t) throw Error('!!timestamp expects a date, starting with yyyy-mm-dd');
				let [, r, n, i, o, s, a] = t.map(Number),
					c = t[7] ? Number((t[7] + '00').substr(1, 3)) : 0,
					u = Date.UTC(r, n - 1, i, o || 0, s || 0, a || 0, c),
					l = t[8];
				if (l && l !== 'Z') {
					let f = Cs(l, !1);
					if (Math.abs(f) < 30) f *= 60;
					u -= 60000 * f;
				}
				return new Date(u);
			},
			stringify: ({ value: e }) => e?.toISOString().replace(/(T00:00:00)?\.000Z$/, '') ?? '',
		};
	Cv.floatTime = _v;
	Cv.intTime = vv;
	Cv.timestamp = of;
});
var af = D(function(Fv) {
	var Ev = pr(),
		Iv = ci(),
		Pv = hr(),
		Ov = Jr(),
		$v = bs(),
		sf = Xl(),
		Ts = ef(),
		yi = rf(),
		Lv = ei(),
		Nv = ws(),
		qv = pi(),
		Dv = _s(),
		As = zs(),
		Mv = [
			Ev.map,
			Pv.seq,
			Ov.string,
			Iv.nullTag,
			sf.trueTag,
			sf.falseTag,
			yi.intBin,
			yi.intOct,
			yi.int,
			yi.intHex,
			Ts.floatNaN,
			Ts.floatExp,
			Ts.float,
			$v.binary,
			Lv.merge,
			Nv.omap,
			qv.pairs,
			Dv.set,
			As.intTime,
			As.floatTime,
			As.timestamp,
		];
	Fv.schema = Mv;
});
var yf = D(function(Hv) {
	var ff = pr(),
		Bv = ci(),
		pf = hr(),
		Zv = Jr(),
		jv = ls(),
		Es = ps(),
		Is = ds(),
		Uv = Zl(),
		Vv = Ul(),
		hf = bs(),
		Yr = ei(),
		df = ws(),
		mf = pi(),
		cf = af(),
		gf = _s(),
		bi = zs(),
		uf = new Map([['core', Uv.schema], ['failsafe', [ff.map, pf.seq, Zv.string]], ['json', Vv.schema], [
			'yaml11',
			cf.schema,
		], ['yaml-1.1', cf.schema]]),
		lf = {
			binary: hf.binary,
			bool: jv.boolTag,
			float: Es.float,
			floatExp: Es.floatExp,
			floatNaN: Es.floatNaN,
			floatTime: bi.floatTime,
			int: Is.int,
			intHex: Is.intHex,
			intOct: Is.intOct,
			intTime: bi.intTime,
			map: ff.map,
			merge: Yr.merge,
			null: Bv.nullTag,
			omap: df.omap,
			pairs: mf.pairs,
			seq: pf.seq,
			set: gf.set,
			timestamp: bi.timestamp,
		},
		Kv = {
			'tag:yaml.org,2002:binary': hf.binary,
			'tag:yaml.org,2002:merge': Yr.merge,
			'tag:yaml.org,2002:omap': df.omap,
			'tag:yaml.org,2002:pairs': mf.pairs,
			'tag:yaml.org,2002:set': gf.set,
			'tag:yaml.org,2002:timestamp': bi.timestamp,
		};
	function Jv(e, t, r) {
		let n = uf.get(t);
		if (n && !e) return r && !n.includes(Yr.merge) ? n.concat(Yr.merge) : n.slice();
		let i = n;
		if (!i) {
			if (Array.isArray(e)) i = [];
			else {
				let o = Array.from(uf.keys()).filter((s) => s !== 'yaml11').map((s) => JSON.stringify(s)).join(', ');
				throw Error(`Unknown schema "${t}"; use one of ${o} or define customTags array`);
			}
		}
		if (Array.isArray(e)) { for (let o of e) i = i.concat(o); }
		else if (typeof e === 'function') i = e(i.slice());
		if (r) i = i.concat(Yr.merge);
		return i.reduce((o, s) => {
			let a = typeof s === 'string' ? lf[s] : s;
			if (!a) {
				let c = JSON.stringify(s), u = Object.keys(lf).map((l) => JSON.stringify(l)).join(', ');
				throw Error(`Unknown custom tag ${c}; use one of ${u}`);
			}
			if (!o.includes(a)) o.push(a);
			return o;
		}, []);
	}
	Hv.coreKnownTags = Kv;
	Hv.getTags = Jv;
});
var $s = D(function(t_) {
	var Ps = W(), Yv = pr(), Qv = hr(), Xv = Jr(), xi = yf(), e_ = (e, t) => e.key < t.key ? -1 : e.key > t.key ? 1 : 0;
	class Os {
		constructor(
			{ compat: e, customTags: t, merge: r, resolveKnownTags: n, schema: i, sortMapEntries: o, toStringDefaults: s },
		) {
			this.compat = Array.isArray(e) ? xi.getTags(e, 'compat') : e ? xi.getTags(null, e) : null,
				this.name = typeof i === 'string' && i || 'core',
				this.knownTags = n ? xi.coreKnownTags : {},
				this.tags = xi.getTags(t, this.name, r),
				this.toStringOptions = s ?? null,
				Object.defineProperty(this, Ps.MAP, { value: Yv.map }),
				Object.defineProperty(this, Ps.SCALAR, { value: Xv.string }),
				Object.defineProperty(this, Ps.SEQ, { value: Qv.seq }),
				this.sortMapEntries = typeof o === 'function' ? o : o === !0 ? e_ : null;
		}
		clone() {
			let e = Object.create(Os.prototype, Object.getOwnPropertyDescriptors(this));
			return e.tags = this.tags.slice(), e;
		}
	}
	t_.Schema = Os;
});
var bf = D(function(o_) {
	var n_ = W(), Ls = Ur(), Qr = Br();
	function i_(e, t) {
		let r = [], n = t.directives === !0;
		if (t.directives !== !1 && e.directives) {
			let c = e.directives.toString(e);
			if (c) r.push(c), n = !0;
			else if (e.directives.docStart) n = !0;
		}
		if (n) r.push('---');
		let i = Ls.createStringifyContext(e, t), { commentString: o } = i.options;
		if (e.commentBefore) {
			if (r.length !== 1) r.unshift('');
			let c = o(e.commentBefore);
			r.unshift(Qr.indentComment(c, ''));
		}
		let s = !1, a = null;
		if (e.contents) {
			if (n_.isNode(e.contents)) {
				if (e.contents.spaceBefore && n) r.push('');
				if (e.contents.commentBefore) {
					let l = o(e.contents.commentBefore);
					r.push(Qr.indentComment(l, ''));
				}
				i.forceBlockIndent = !!e.comment, a = e.contents.comment;
			}
			let c = a ? void 0 : () => s = !0, u = Ls.stringify(e.contents, i, () => a = null, c);
			if (a) u += Qr.lineComment(u, '', o(a));
			if ((u[0] === '|' || u[0] === '>') && r[r.length - 1] === '---') r[r.length - 1] = `--- ${u}`;
			else r.push(u);
		} else r.push(Ls.stringify(e.contents, i));
		if (e.directives?.docEnd) {
			if (e.comment) {
				let c = o(e.comment);
				if (
					c.includes(`
`)
				) r.push('...'), r.push(Qr.indentComment(c, ''));
				else r.push(`... ${c}`);
			} else r.push('...');
		} else {
			let c = e.comment;
			if (c && s) c = c.replace(/^\n+/, '');
			if (c) {
				if ((!s || a) && r[r.length - 1] !== '') r.push('');
				r.push(Qr.indentComment(o(c), ''));
			}
		}
		return r.join(`
`) + `
`;
	}
	o_.stringifyDocument = i_;
});
var Xr = D(function(d_) {
	var a_ = Fr(),
		mr = Jn(),
		$e = W(),
		c_ = dt(),
		u_ = ft(),
		l_ = $s(),
		f_ = bf(),
		Ns = Un(),
		p_ = es(),
		h_ = Rr(),
		qs = Xo();
	class Ds {
		constructor(e, t, r) {
			this.commentBefore = null,
				this.comment = null,
				this.errors = [],
				this.warnings = [],
				Object.defineProperty(this, $e.NODE_TYPE, { value: $e.DOC });
			let n = null;
			if (typeof t === 'function' || Array.isArray(t)) n = t;
			else if (r === void 0 && t) r = t, t = void 0;
			let i = Object.assign({
				intAsBigInt: !1,
				keepSourceTokens: !1,
				logLevel: 'warn',
				prettyErrors: !0,
				strict: !0,
				stringKeys: !1,
				uniqueKeys: !0,
				version: '1.2',
			}, r);
			this.options = i;
			let { version: o } = i;
			if (r?._directives) {
				if (this.directives = r._directives.atDocument(), this.directives.yaml.explicit) {
					o = this.directives.yaml.version;
				}
			} else this.directives = new qs.Directives({ version: o });
			this.setSchema(o, r), this.contents = e === void 0 ? null : this.createNode(e, n, r);
		}
		clone() {
			let e = Object.create(Ds.prototype, { [$e.NODE_TYPE]: { value: $e.DOC } });
			if (
				e.commentBefore = this.commentBefore,
					e.comment = this.comment,
					e.errors = this.errors.slice(),
					e.warnings = this.warnings.slice(),
					e.options = Object.assign({}, this.options),
					this.directives
			) e.directives = this.directives.clone();
			if (
				e.schema = this.schema.clone(),
					e.contents = $e.isNode(this.contents) ? this.contents.clone(e.schema) : this.contents,
					this.range
			) e.range = this.range.slice();
			return e;
		}
		add(e) {
			if (gr(this.contents)) this.contents.add(e);
		}
		addIn(e, t) {
			if (gr(this.contents)) this.contents.addIn(e, t);
		}
		createAlias(e, t) {
			if (!e.anchor) {
				let r = Ns.anchorNames(this);
				e.anchor = !t || r.has(t) ? Ns.findNewAnchor(t || 'a', r) : t;
			}
			return new a_.Alias(e.anchor);
		}
		createNode(e, t, r) {
			let n = void 0;
			if (typeof t === 'function') e = t.call({ '': e }, '', e), n = t;
			else if (Array.isArray(t)) {
				let y = (k) => typeof k === 'number' || k instanceof String || k instanceof Number, x = t.filter(y).map(String);
				if (x.length > 0) t = t.concat(x);
				n = t;
			} else if (r === void 0 && t) r = t, t = void 0;
			let { aliasDuplicateObjects: i, anchorPrefix: o, flow: s, keepUndefined: a, onTagObj: c, tag: u } = r ?? {},
				{ onAnchor: l, setAnchors: f, sourceObjects: h } = Ns.createNodeAnchors(this, o || 'a'),
				d = {
					aliasDuplicateObjects: i ?? !0,
					keepUndefined: a ?? !1,
					onAnchor: l,
					onTagObj: c,
					replacer: n,
					schema: this.schema,
					sourceObjects: h,
				},
				g = h_.createNode(e, u, d);
			if (s && $e.isCollection(g)) g.flow = !0;
			return f(), g;
		}
		createPair(e, t, r = {}) {
			let n = this.createNode(e, null, r), i = this.createNode(t, null, r);
			return new c_.Pair(n, i);
		}
		delete(e) {
			return gr(this.contents) ? this.contents.delete(e) : !1;
		}
		deleteIn(e) {
			if (mr.isEmptyPath(e)) {
				if (this.contents == null) return !1;
				return this.contents = null, !0;
			}
			return gr(this.contents) ? this.contents.deleteIn(e) : !1;
		}
		get(e, t) {
			return $e.isCollection(this.contents) ? this.contents.get(e, t) : void 0;
		}
		getIn(e, t) {
			if (mr.isEmptyPath(e)) return !t && $e.isScalar(this.contents) ? this.contents.value : this.contents;
			return $e.isCollection(this.contents) ? this.contents.getIn(e, t) : void 0;
		}
		has(e) {
			return $e.isCollection(this.contents) ? this.contents.has(e) : !1;
		}
		hasIn(e) {
			if (mr.isEmptyPath(e)) return this.contents !== void 0;
			return $e.isCollection(this.contents) ? this.contents.hasIn(e) : !1;
		}
		set(e, t) {
			if (this.contents == null) this.contents = mr.collectionFromPath(this.schema, [e], t);
			else if (gr(this.contents)) this.contents.set(e, t);
		}
		setIn(e, t) {
			if (mr.isEmptyPath(e)) this.contents = t;
			else if (this.contents == null) this.contents = mr.collectionFromPath(this.schema, Array.from(e), t);
			else if (gr(this.contents)) this.contents.setIn(e, t);
		}
		setSchema(e, t = {}) {
			if (typeof e === 'number') e = String(e);
			let r;
			switch (e) {
				case '1.1':
					if (this.directives) this.directives.yaml.version = '1.1';
					else this.directives = new qs.Directives({ version: '1.1' });
					r = { resolveKnownTags: !1, schema: 'yaml-1.1' };
					break;
				case '1.2':
				case 'next':
					if (this.directives) this.directives.yaml.version = e;
					else this.directives = new qs.Directives({ version: e });
					r = { resolveKnownTags: !0, schema: 'core' };
					break;
				case null:
					if (this.directives) delete this.directives;
					r = null;
					break;
				default: {
					let n = JSON.stringify(e);
					throw Error(`Expected '1.1', '1.2' or null as first argument, but found: ${n}`);
				}
			}
			if (t.schema instanceof Object) this.schema = t.schema;
			else if (r) this.schema = new l_.Schema(Object.assign(r, t));
			else throw Error('With a null YAML version, the { schema: Schema } option is required');
		}
		toJS({ json: e, jsonArg: t, mapAsMap: r, maxAliasCount: n, onAnchor: i, reviver: o } = {}) {
			let s = {
					anchors: new Map(),
					doc: this,
					keep: !e,
					mapAsMap: r === !0,
					mapKeyWarned: !1,
					maxAliasCount: typeof n === 'number' ? n : 100,
				},
				a = u_.toJS(this.contents, t ?? '', s);
			if (typeof i === 'function') { for (let { count: c, res: u } of s.anchors.values()) i(u, c); }
			return typeof o === 'function' ? p_.applyReviver(o, { '': a }, '', a) : a;
		}
		toJSON(e, t) {
			return this.toJS({ json: !0, jsonArg: e, mapAsMap: !1, onAnchor: t });
		}
		toString(e = {}) {
			if (this.errors.length > 0) throw Error('Document with errors cannot be stringified');
			if ('indent' in e && (!Number.isInteger(e.indent) || Number(e.indent) <= 0)) {
				let t = JSON.stringify(e.indent);
				throw Error(`"indent" option must be a positive integer, not ${t}`);
			}
			return f_.stringifyDocument(this, e);
		}
	}
	function gr(e) {
		if ($e.isCollection(e)) return !0;
		throw Error('Expected a YAML collection as document contents');
	}
	d_.Document = Ds;
});
var en = D(function(y_) {
	class ki extends Error {
		constructor(e, t, r, n) {
			super();
			this.name = e, this.code = r, this.message = n, this.pos = t;
		}
	}
	class xf extends ki {
		constructor(e, t, r) {
			super('YAMLParseError', e, t, r);
		}
	}
	class kf extends ki {
		constructor(e, t, r) {
			super('YAMLWarning', e, t, r);
		}
	}
	var g_ = (e, t) => (r) => {
		if (r.pos[0] === -1) return;
		r.linePos = r.pos.map((a) => t.linePos(a));
		let { line: n, col: i } = r.linePos[0];
		r.message += ` at line ${n}, column ${i}`;
		let o = i - 1, s = e.substring(t.lineStarts[n - 1], t.lineStarts[n]).replace(/[\n\r]+$/, '');
		if (o >= 60 && s.length > 80) {
			let a = Math.min(o - 39, s.length - 79);
			s = '…' + s.substring(a), o -= a - 1;
		}
		if (s.length > 80) s = s.substring(0, 79) + '…';
		if (n > 1 && /^ *$/.test(s.substring(0, o))) {
			let a = e.substring(t.lineStarts[n - 2], t.lineStarts[n - 1]);
			if (a.length > 80) {
				a = a.substring(0, 79) + `…
`;
			}
			s = a + s;
		}
		if (/[^ ]/.test(s)) {
			let a = 1, c = r.linePos[1];
			if (c?.line === n && c.col > i) a = Math.max(1, Math.min(c.col - i, 80 - o));
			let u = ' '.repeat(o) + '^'.repeat(a);
			r.message += `:

${s}
${u}
`;
		}
	};
	y_.YAMLError = ki;
	y_.YAMLParseError = xf;
	y_.YAMLWarning = kf;
	y_.prettifyError = g_;
});
var tn = D(function(v_) {
	function S_(e, { flow: t, indicator: r, next: n, offset: i, onError: o, parentIndent: s, startOnNewline: a }) {
		let c = !1,
			u = a,
			l = a,
			f = '',
			h = '',
			d = !1,
			g = !1,
			y = null,
			x = null,
			k = null,
			z = null,
			_ = null,
			O = null,
			I = null;
		for (let L of e) {
			if (g) {
				if (L.type !== 'space' && L.type !== 'newline' && L.type !== 'comma') {
					o(L.offset, 'MISSING_CHAR', 'Tags and anchors must be separated from the next token by white space');
				}
				g = !1;
			}
			if (y) {
				if (u && L.type !== 'comment' && L.type !== 'newline') {
					o(y, 'TAB_AS_INDENT', 'Tabs are not allowed as indentation');
				}
				y = null;
			}
			switch (L.type) {
				case 'space':
					if (!t && (r !== 'doc-start' || n?.type !== 'flow-collection') && L.source.includes('\t')) y = L;
					l = !0;
					break;
				case 'comment': {
					if (!l) o(L, 'MISSING_CHAR', 'Comments must be separated from other tokens by white space characters');
					let U = L.source.substring(1) || ' ';
					if (!f) f = U;
					else f += h + U;
					h = '', u = !1;
					break;
				}
				case 'newline':
					if (u) {
						if (f) f += L.source;
						else if (!O || r !== 'seq-item-ind') c = !0;
					} else h += L.source;
					if (u = !0, d = !0, x || k) z = L;
					l = !0;
					break;
				case 'anchor':
					if (x) o(L, 'MULTIPLE_ANCHORS', 'A node can have at most one anchor');
					if (L.source.endsWith(':')) {
						o(
							L.offset + L.source.length - 1,
							'BAD_ALIAS',
							'Anchor ending in : is ambiguous',
							!0,
						);
					}
					x = L, I ?? (I = L.offset), u = !1, l = !1, g = !0;
					break;
				case 'tag': {
					if (k) o(L, 'MULTIPLE_TAGS', 'A node can have at most one tag');
					k = L, I ?? (I = L.offset), u = !1, l = !1, g = !0;
					break;
				}
				case r:
					if (x || k) o(L, 'BAD_PROP_ORDER', `Anchors and tags must be after the ${L.source} indicator`);
					if (O) o(L, 'UNEXPECTED_TOKEN', `Unexpected ${L.source} in ${t ?? 'collection'}`);
					O = L, u = r === 'seq-item-ind' || r === 'explicit-key-ind', l = !1;
					break;
				case 'comma':
					if (t) {
						if (_) o(L, 'UNEXPECTED_TOKEN', `Unexpected , in ${t}`);
						_ = L, u = !1, l = !1;
						break;
					}
				default:
					o(L, 'UNEXPECTED_TOKEN', `Unexpected ${L.type} token`), u = !1, l = !1;
			}
		}
		let v = e[e.length - 1], q = v ? v.offset + v.source.length : i;
		if (
			g && n && n.type !== 'space' && n.type !== 'newline' && n.type !== 'comma'
			&& (n.type !== 'scalar' || n.source !== '')
		) o(n.offset, 'MISSING_CHAR', 'Tags and anchors must be separated from the next token by white space');
		if (y && (u && y.indent <= s || n?.type === 'block-map' || n?.type === 'block-seq')) {
			o(y, 'TAB_AS_INDENT', 'Tabs are not allowed as indentation');
		}
		return {
			comma: _,
			found: O,
			spaceBefore: c,
			comment: f,
			hasNewline: d,
			anchor: x,
			tag: k,
			newlineAfterProp: z,
			end: q,
			start: I ?? q,
		};
	}
	v_.resolveProps = S_;
});
var wi = D(function(C_) {
	function Ms(e) {
		if (!e) return null;
		switch (e.type) {
			case 'alias':
			case 'scalar':
			case 'double-quoted-scalar':
			case 'single-quoted-scalar':
				if (
					e.source.includes(`
`)
				) return !0;
				if (e.end) { for (let t of e.end) if (t.type === 'newline') return !0; }
				return !1;
			case 'flow-collection':
				for (let t of e.items) {
					for (let r of t.start) if (r.type === 'newline') return !0;
					if (t.sep) { for (let r of t.sep) if (r.type === 'newline') return !0; }
					if (Ms(t.key) || Ms(t.value)) return !0;
				}
				return !1;
			default:
				return !0;
		}
	}
	C_.containsNewline = Ms;
});
var Fs = D(function(E_) {
	var T_ = wi();
	function A_(e, t, r) {
		if (t?.type === 'flow-collection') {
			let n = t.end[0];
			if (n.indent === e && (n.source === ']' || n.source === '}') && T_.containsNewline(t)) {
				r(n, 'BAD_INDENT', 'Flow end indicator should be more indented than parent', !0);
			}
		}
	}
	E_.flowIndentCheck = A_;
});
var Rs = D(function(O_) {
	var wf = W();
	function P_(e, t, r) {
		let { uniqueKeys: n } = e.options;
		if (n === !1) return !1;
		let i = typeof n === 'function' ? n : (o, s) => o === s || wf.isScalar(o) && wf.isScalar(s) && o.value === s.value;
		return t.some((o) => i(o.key, r));
	}
	O_.mapIncludes = P_;
});
var zf = D(function(M_) {
	var Sf = dt(),
		L_ = gt(),
		vf = tn(),
		N_ = wi(),
		_f = Fs(),
		q_ = Rs(),
		Cf = 'All mapping items must start at the same column';
	function D_({ composeNode: e, composeEmptyNode: t }, r, n, i, o) {
		let a = new (o?.nodeClass ?? L_.YAMLMap)(r.schema);
		if (r.atRoot) r.atRoot = !1;
		let c = n.offset, u = null;
		for (let l of n.items) {
			let { start: f, key: h, sep: d, value: g } = l,
				y = vf.resolveProps(f, {
					indicator: 'explicit-key-ind',
					next: h ?? d?.[0],
					offset: c,
					onError: i,
					parentIndent: n.indent,
					startOnNewline: !0,
				}),
				x = !y.found;
			if (x) {
				if (h) {
					if (h.type === 'block-seq') {
						i(c, 'BLOCK_AS_IMPLICIT_KEY', 'A block sequence may not be used as an implicit map key');
					} else if ('indent' in h && h.indent !== n.indent) {
						i(c, 'BAD_INDENT', Cf);
					}
				}
				if (!y.anchor && !y.tag && !d) {
					if (u = y.end, y.comment) {
						if (a.comment) {
							a.comment += `
` + y.comment;
						} else a.comment = y.comment;
					}
					continue;
				}
				if (y.newlineAfterProp || N_.containsNewline(h)) {
					i(
						h ?? f[f.length - 1],
						'MULTILINE_IMPLICIT_KEY',
						'Implicit keys need to be on a single line',
					);
				}
			} else if (y.found?.indent !== n.indent) i(c, 'BAD_INDENT', Cf);
			r.atKey = !0;
			let k = y.end, z = h ? e(r, h, y, i) : t(r, k, f, null, y, i);
			if (r.schema.compat) _f.flowIndentCheck(n.indent, h, i);
			if (r.atKey = !1, q_.mapIncludes(r, a.items, z)) i(k, 'DUPLICATE_KEY', 'Map keys must be unique');
			let _ = vf.resolveProps(d ?? [], {
				indicator: 'map-value-ind',
				next: g,
				offset: z.range[2],
				onError: i,
				parentIndent: n.indent,
				startOnNewline: !h || h.type === 'block-scalar',
			});
			if (c = _.end, _.found) {
				if (x) {
					if (g?.type === 'block-map' && !_.hasNewline) {
						i(c, 'BLOCK_AS_IMPLICIT_KEY', 'Nested mappings are not allowed in compact mappings');
					}
					if (r.options.strict && y.start < _.found.offset - 1024) {
						i(
							z.range,
							'KEY_OVER_1024_CHARS',
							'The : indicator must be at most 1024 chars after the start of an implicit block mapping key',
						);
					}
				}
				let O = g ? e(r, g, _, i) : t(r, c, d, null, _, i);
				if (r.schema.compat) _f.flowIndentCheck(n.indent, g, i);
				c = O.range[2];
				let I = new Sf.Pair(z, O);
				if (r.options.keepSourceTokens) I.srcToken = l;
				a.items.push(I);
			} else {
				if (x) i(z.range, 'MISSING_CHAR', 'Implicit map keys need to be followed by map values');
				if (_.comment) {
					if (z.comment) {
						z.comment += `
` + _.comment;
					} else z.comment = _.comment;
				}
				let O = new Sf.Pair(z);
				if (r.options.keepSourceTokens) O.srcToken = l;
				a.items.push(O);
			}
		}
		if (u && u < c) i(u, 'IMPOSSIBLE', 'Map comment with trailing content');
		return a.range = [n.offset, c, u ?? c], a;
	}
	M_.resolveBlockMap = D_;
});
var Tf = D(function(U_) {
	var R_ = yt(), B_ = tn(), Z_ = Fs();
	function j_({ composeNode: e, composeEmptyNode: t }, r, n, i, o) {
		let a = new (o?.nodeClass ?? R_.YAMLSeq)(r.schema);
		if (r.atRoot) r.atRoot = !1;
		if (r.atKey) r.atKey = !1;
		let c = n.offset, u = null;
		for (let { start: l, value: f } of n.items) {
			let h = B_.resolveProps(l, {
				indicator: 'seq-item-ind',
				next: f,
				offset: c,
				onError: i,
				parentIndent: n.indent,
				startOnNewline: !0,
			});
			if (!h.found) {
				if (h.anchor || h.tag || f) {
					if (f?.type === 'block-seq') i(h.end, 'BAD_INDENT', 'All sequence items must start at the same column');
					else i(c, 'MISSING_CHAR', 'Sequence item without - indicator');
				} else {
					if (u = h.end, h.comment) a.comment = h.comment;
					continue;
				}
			}
			let d = f ? e(r, f, h, i) : t(r, h.end, l, null, h, i);
			if (r.schema.compat) Z_.flowIndentCheck(n.indent, f, i);
			c = d.range[2], a.items.push(d);
		}
		return a.range = [n.offset, c, u ?? c], a;
	}
	U_.resolveBlockSeq = j_;
});
var yr = D(function(J_) {
	function K_(e, t, r, n) {
		let i = '';
		if (e) {
			let o = !1, s = '';
			for (let a of e) {
				let { source: c, type: u } = a;
				switch (u) {
					case 'space':
						o = !0;
						break;
					case 'comment': {
						if (r && !o) n(a, 'MISSING_CHAR', 'Comments must be separated from other tokens by white space characters');
						let l = c.substring(1) || ' ';
						if (!i) i = l;
						else i += s + l;
						s = '';
						break;
					}
					case 'newline':
						if (i) s += c;
						o = !0;
						break;
					default:
						n(a, 'UNEXPECTED_TOKEN', `Unexpected ${u} at node end`);
				}
				t += c.length;
			}
		}
		return { comment: i, offset: t };
	}
	J_.resolveEnd = K_;
});
var If = D(function(r0) {
	var G_ = W(),
		W_ = dt(),
		Af = gt(),
		Y_ = yt(),
		Q_ = yr(),
		Ef = tn(),
		X_ = wi(),
		e0 = Rs(),
		Bs = 'Block collections are not allowed within flow collections',
		Zs = (e) => e && (e.type === 'block-map' || e.type === 'block-seq');
	function t0({ composeNode: e, composeEmptyNode: t }, r, n, i, o) {
		let s = n.start.source === '{',
			a = s ? 'flow map' : 'flow sequence',
			u = new (o?.nodeClass ?? (s ? Af.YAMLMap : Y_.YAMLSeq))(r.schema);
		u.flow = !0;
		let l = r.atRoot;
		if (l) r.atRoot = !1;
		if (r.atKey) r.atKey = !1;
		let f = n.offset + n.start.source.length;
		for (let x = 0; x < n.items.length; ++x) {
			let k = n.items[x],
				{ start: z, key: _, sep: O, value: I } = k,
				v = Ef.resolveProps(z, {
					flow: a,
					indicator: 'explicit-key-ind',
					next: _ ?? O?.[0],
					offset: f,
					onError: i,
					parentIndent: n.indent,
					startOnNewline: !1,
				});
			if (!v.found) {
				if (!v.anchor && !v.tag && !O && !I) {
					if (x === 0 && v.comma) i(v.comma, 'UNEXPECTED_TOKEN', `Unexpected , in ${a}`);
					else if (x < n.items.length - 1) i(v.start, 'UNEXPECTED_TOKEN', `Unexpected empty item in ${a}`);
					if (v.comment) {
						if (u.comment) {
							u.comment += `
` + v.comment;
						} else u.comment = v.comment;
					}
					f = v.end;
					continue;
				}
				if (!s && r.options.strict && X_.containsNewline(_)) {
					i(_, 'MULTILINE_IMPLICIT_KEY', 'Implicit keys of flow sequence pairs need to be on a single line');
				}
			}
			if (x === 0) { if (v.comma) i(v.comma, 'UNEXPECTED_TOKEN', `Unexpected , in ${a}`); }
			else {
				if (!v.comma) i(v.start, 'MISSING_CHAR', `Missing , between ${a} items`);
				if (v.comment) {
					let q = '';
					e: for (let L of z) {
						switch (L.type) {
							case 'comma':
							case 'space':
								break;
							case 'comment':
								q = L.source.substring(1);
								break e;
							default:
								break e;
						}
					}
					if (q) {
						let L = u.items[u.items.length - 1];
						if (G_.isPair(L)) L = L.value ?? L.key;
						if (L.comment) {
							L.comment += `
` + q;
						} else L.comment = q;
						v.comment = v.comment.substring(q.length + 1);
					}
				}
			}
			if (!s && !O && !v.found) {
				let q = I ? e(r, I, v, i) : t(r, v.end, O, null, v, i);
				if (u.items.push(q), f = q.range[2], Zs(I)) i(q.range, 'BLOCK_IN_FLOW', Bs);
			} else {
				r.atKey = !0;
				let q = v.end, L = _ ? e(r, _, v, i) : t(r, q, z, null, v, i);
				if (Zs(_)) i(L.range, 'BLOCK_IN_FLOW', Bs);
				r.atKey = !1;
				let U = Ef.resolveProps(O ?? [], {
					flow: a,
					indicator: 'map-value-ind',
					next: I,
					offset: L.range[2],
					onError: i,
					parentIndent: n.indent,
					startOnNewline: !1,
				});
				if (U.found) {
					if (!s && !v.found && r.options.strict) {
						if (O) {
							for (let Z of O) {
								if (Z === U.found) break;
								if (Z.type === 'newline') {
									i(Z, 'MULTILINE_IMPLICIT_KEY', 'Implicit keys of flow sequence pairs need to be on a single line');
									break;
								}
							}
						}
						if (v.start < U.found.offset - 1024) {
							i(
								U.found,
								'KEY_OVER_1024_CHARS',
								'The : indicator must be at most 1024 chars after the start of an implicit flow sequence key',
							);
						}
					}
				} else if (I) {
					if ('source' in I && I.source?.[0] === ':') i(I, 'MISSING_CHAR', `Missing space after : in ${a}`);
					else i(U.start, 'MISSING_CHAR', `Missing , or : between ${a} items`);
				}
				let C = I ? e(r, I, U, i) : U.found ? t(r, U.end, O, null, U, i) : null;
				if (C) { if (Zs(I)) i(C.range, 'BLOCK_IN_FLOW', Bs); }
				else if (U.comment) {
					if (L.comment) {
						L.comment += `
` + U.comment;
					} else L.comment = U.comment;
				}
				let J = new W_.Pair(L, C);
				if (r.options.keepSourceTokens) J.srcToken = k;
				if (s) {
					let Z = u;
					if (e0.mapIncludes(r, Z.items, L)) i(q, 'DUPLICATE_KEY', 'Map keys must be unique');
					Z.items.push(J);
				} else {
					let Z = new Af.YAMLMap(r.schema);
					Z.flow = !0, Z.items.push(J);
					let M = (C ?? L).range;
					Z.range = [L.range[0], M[1], M[2]], u.items.push(Z);
				}
				f = C ? C.range[2] : U.end;
			}
		}
		let h = s ? '}' : ']', [d, ...g] = n.end, y = f;
		if (d?.source === h) y = d.offset + d.source.length;
		else {
			let x = a[0].toUpperCase() + a.substring(1),
				k = l
					? `${x} must end with a ${h}`
					: `${x} in block collection must be sufficiently indented and end with a ${h}`;
			if (i(f, l ? 'MISSING_CHAR' : 'BAD_INDENT', k), d && d.source.length !== 1) g.unshift(d);
		}
		if (g.length > 0) {
			let x = Q_.resolveEnd(g, y, r.options.strict, i);
			if (x.comment) {
				if (u.comment) {
					u.comment += `
` + x.comment;
				} else u.comment = x.comment;
			}
			u.range = [n.offset, y, x.offset];
		} else u.range = [n.offset, y, y];
		return u;
	}
	r0.resolveFlowCollection = t0;
});
var Pf = D(function(p0) {
	var i0 = W(), o0 = ce(), s0 = gt(), a0 = yt(), c0 = zf(), u0 = Tf(), l0 = If();
	function js(e, t, r, n, i, o) {
		let s = r.type === 'block-map'
				? c0.resolveBlockMap(e, t, r, n, o)
				: r.type === 'block-seq'
				? u0.resolveBlockSeq(e, t, r, n, o)
				: l0.resolveFlowCollection(e, t, r, n, o),
			a = s.constructor;
		if (i === '!' || i === a.tagName) return s.tag = a.tagName, s;
		if (i) s.tag = i;
		return s;
	}
	function f0(e, t, r, n, i) {
		let o = n.tag, s = !o ? null : t.directives.tagName(o.source, (h) => i(o, 'TAG_RESOLVE_FAILED', h));
		if (r.type === 'block-seq') {
			let { anchor: h, newlineAfterProp: d } = n, g = h && o ? h.offset > o.offset ? h : o : h ?? o;
			if (g && (!d || d.offset < g.offset)) i(g, 'MISSING_CHAR', 'Missing newline after block sequence props');
		}
		let a = r.type === 'block-map' ? 'map' : r.type === 'block-seq' ? 'seq' : r.start.source === '{' ? 'map' : 'seq';
		if (!o || !s || s === '!' || s === s0.YAMLMap.tagName && a === 'map' || s === a0.YAMLSeq.tagName && a === 'seq') {
			return js(e, t, r, i, s);
		}
		let c = t.schema.tags.find((h) => h.tag === s && h.collection === a);
		if (!c) {
			let h = t.schema.knownTags[s];
			if (h?.collection === a) t.schema.tags.push(Object.assign({}, h, { default: !1 })), c = h;
			else {
				if (h) {
					i(o, 'BAD_COLLECTION_TYPE', `${h.tag} used for ${a} collection, but expects ${h.collection ?? 'scalar'}`, !0);
				} else i(o, 'TAG_RESOLVE_FAILED', `Unresolved tag: ${s}`, !0);
				return js(e, t, r, i, s);
			}
		}
		let u = js(e, t, r, i, s, c),
			l = c.resolve?.(u, (h) => i(o, 'TAG_RESOLVE_FAILED', h), t.options) ?? u,
			f = i0.isNode(l) ? l : new o0.Scalar(l);
		if (f.range = u.range, f.tag = s, c?.format) f.format = c.format;
		return f;
	}
	p0.composeCollection = f0;
});
var Vs = D(function(y0) {
	var Us = ce();
	function d0(e, t, r) {
		let n = t.offset, i = m0(t, e.options.strict, r);
		if (!i) return { value: '', type: null, comment: '', range: [n, n, n] };
		let o = i.mode === '>' ? Us.Scalar.BLOCK_FOLDED : Us.Scalar.BLOCK_LITERAL,
			s = t.source ? g0(t.source) : [],
			a = s.length;
		for (let y = s.length - 1; y >= 0; --y) {
			let x = s[y][1];
			if (x === '' || x === '\r') a = y;
			else break;
		}
		if (a === 0) {
			let y = i.chomp === '+' && s.length > 0
					? `
`.repeat(Math.max(1, s.length - 1))
					: '',
				x = n + i.length;
			if (t.source) x += t.source.length;
			return { value: y, type: o, comment: i.comment, range: [n, x, x] };
		}
		let c = t.indent + i.indent, u = t.offset + i.length, l = 0;
		for (let y = 0; y < a; ++y) {
			let [x, k] = s[y];
			if (k === '' || k === '\r') { if (i.indent === 0 && x.length > c) c = x.length; }
			else {
				if (x.length < c) {
					r(
						u + x.length,
						'MISSING_CHAR',
						'Block scalars with more-indented leading empty lines must use an explicit indentation indicator',
					);
				}
				if (i.indent === 0) c = x.length;
				if (l = y, c === 0 && !e.atRoot) r(u, 'BAD_INDENT', 'Block scalar values in collections must be indented');
				break;
			}
			u += x.length + k.length + 1;
		}
		for (let y = s.length - 1; y >= a; --y) if (s[y][0].length > c) a = y + 1;
		let f = '', h = '', d = !1;
		for (let y = 0; y < l; ++y) {
			f += s[y][0].slice(c) + `
`;
		}
		for (let y = l; y < a; ++y) {
			let [x, k] = s[y];
			u += x.length + k.length + 1;
			let z = k[k.length - 1] === '\r';
			if (z) k = k.slice(0, -1);
			if (k && x.length < c) {
				let O = `Block scalar lines must not be less indented than their ${
					i.indent ? 'explicit indentation indicator' : 'first line'
				}`;
				r(u - k.length - (z ? 2 : 1), 'BAD_INDENT', O), x = '';
			}
			if (o === Us.Scalar.BLOCK_LITERAL) {
				f += h + x.slice(c) + k,
					h = `
`;
			} else if (x.length > c || k[0] === '\t') {
				if (h === ' ') {
					h = `
`;
				} else if (
					!d && h === `
`
				) {
					h = `

`;
				}
				f += h + x.slice(c) + k,
					h = `
`,
					d = !0;
			} else if (k === '') {
				if (
					h === `
`
				) {
					f += `
`;
				} else {h = `
`;}
			} else f += h + k, h = ' ', d = !1;
		}
		switch (i.chomp) {
			case '-':
				break;
			case '+':
				for (let y = a; y < s.length; ++y) {
					f += `
` + s[y][0].slice(c);
				}
				if (
					f[f.length - 1] !== `
`
				) {
					f += `
`;
				}
				break;
			default:
				f += `
`;
		}
		let g = n + i.length + t.source.length;
		return { value: f, type: o, comment: i.comment, range: [n, g, g] };
	}
	function m0({ offset: e, props: t }, r, n) {
		if (t[0].type !== 'block-scalar-header') return n(t[0], 'IMPOSSIBLE', 'Block scalar header not found'), null;
		let { source: i } = t[0], o = i[0], s = 0, a = '', c = -1;
		for (let h = 1; h < i.length; ++h) {
			let d = i[h];
			if (!a && (d === '-' || d === '+')) a = d;
			else {
				let g = Number(d);
				if (!s && g) s = g;
				else if (c === -1) c = e + h;
			}
		}
		if (c !== -1) n(c, 'UNEXPECTED_TOKEN', `Block scalar header includes extra characters: ${i}`);
		let u = !1, l = '', f = i.length;
		for (let h = 1; h < t.length; ++h) {
			let d = t[h];
			switch (d.type) {
				case 'space':
					u = !0;
				case 'newline':
					f += d.source.length;
					break;
				case 'comment':
					if (r && !u) n(d, 'MISSING_CHAR', 'Comments must be separated from other tokens by white space characters');
					f += d.source.length, l = d.source.substring(1);
					break;
				case 'error':
					n(d, 'UNEXPECTED_TOKEN', d.message), f += d.source.length;
					break;
				default: {
					let g = `Unexpected token in block scalar header: ${d.type}`;
					n(d, 'UNEXPECTED_TOKEN', g);
					let y = d.source;
					if (y && typeof y === 'string') f += y.length;
				}
			}
		}
		return { mode: o, indent: s, chomp: a, comment: l, length: f };
	}
	function g0(e) {
		let t = e.split(/\n( *)/), r = t[0], n = r.match(/^( *)/), o = [n?.[1] ? [n[1], r.slice(n[1].length)] : ['', r]];
		for (let s = 1; s < t.length; s += 2) o.push([t[s], t[s + 1]]);
		return o;
	}
	y0.resolveBlockScalar = d0;
});
var Js = D(function(T0) {
	var Ks = ce(), x0 = yr();
	function k0(e, t, r) {
		let { offset: n, type: i, source: o, end: s } = e, a, c, u = (h, d, g) => r(n + h, d, g);
		switch (i) {
			case 'scalar':
				a = Ks.Scalar.PLAIN, c = w0(o, u);
				break;
			case 'single-quoted-scalar':
				a = Ks.Scalar.QUOTE_SINGLE, c = S0(o, u);
				break;
			case 'double-quoted-scalar':
				a = Ks.Scalar.QUOTE_DOUBLE, c = v0(o, u);
				break;
			default:
				return r(e, 'UNEXPECTED_TOKEN', `Expected a flow scalar value, but found: ${i}`),
					{ value: '', type: null, comment: '', range: [n, n + o.length, n + o.length] };
		}
		let l = n + o.length, f = x0.resolveEnd(s, l, t, r);
		return { value: c, type: a, comment: f.comment, range: [n, l, f.offset] };
	}
	function w0(e, t) {
		let r = '';
		switch (e[0]) {
			case '\t':
				r = 'a tab character';
				break;
			case ',':
				r = 'flow indicator character ,';
				break;
			case '%':
				r = 'directive indicator character %';
				break;
			case '|':
			case '>': {
				r = `block scalar indicator ${e[0]}`;
				break;
			}
			case '@':
			case '`': {
				r = `reserved character ${e[0]}`;
				break;
			}
		}
		if (r) t(0, 'BAD_SCALAR_START', `Plain value cannot start with ${r}`);
		return Of(e);
	}
	function S0(e, t) {
		if (e[e.length - 1] !== "'" || e.length === 1) t(e.length, 'MISSING_CHAR', "Missing closing 'quote");
		return Of(e.slice(1, -1)).replace(/''/g, "'");
	}
	function Of(e) {
		let t = /(.*?)\r?\n/sy, r = t.exec(e);
		if (!r) return e;
		let n, i;
		try {
			n = new RegExp('(?<![ \t])[ \t]+$'), i = new RegExp('^[ \t]+|(?<![ \t])[ \t]+$', 'g');
		} catch {
			n = /[ \t]+$/, i = /^[ \t]+|[ \t]+$/g;
		}
		let o = r[1].replace(n, ''), s = ' ', a = t.lastIndex;
		while (r = t.exec(e)) {
			let u = r[1].replace(i, '');
			if (u === '') {
				if (
					s === `
`
				) o += s;
				else {s = `
`;}
			} else o += s + u, s = ' ';
			a = t.lastIndex;
		}
		let c = /[ \t]*(.*)/sy;
		return c.lastIndex = a, r = c.exec(e), o + s + (r?.[1] ?? '');
	}
	function v0(e, t) {
		let r = '';
		for (let n = 1; n < e.length - 1; ++n) {
			let i = e[n];
			if (
				i === '\r' && e[n + 1] === `
`
			) continue;
			if (
				i === `
`
			) {
				let { fold: o, offset: s } = _0(e, n);
				r += o, n = s;
			} else if (i === '\\') {
				let o = e[++n], s = C0[o];
				if (s) r += s;
				else if (
					o === `
`
				) {
					o = e[n + 1];
					while (o === ' ' || o === '\t') o = e[++n + 1];
				} else if (
					o === '\r' && e[n + 1] === `
`
				) {
					o = e[++n + 1];
					while (o === ' ' || o === '\t') o = e[++n + 1];
				} else if (o === 'x' || o === 'u' || o === 'U') {
					let a = o === 'x' ? 2 : o === 'u' ? 4 : 8;
					r += z0(e, n + 1, a, t), n += a;
				} else {
					let a = e.substr(n - 1, 2);
					t(n - 1, 'BAD_DQ_ESCAPE', `Invalid escape sequence ${a}`), r += a;
				}
			} else if (i === ' ' || i === '\t') {
				let o = n, s = e[n + 1];
				while (s === ' ' || s === '\t') s = e[++n + 1];
				if (
					s !== `
` && !(s === '\r' && e[n + 2] === `
`)
				) r += n > o ? e.slice(o, n + 1) : i;
			} else r += i;
		}
		if (e[e.length - 1] !== '"' || e.length === 1) t(e.length, 'MISSING_CHAR', 'Missing closing "quote');
		return r;
	}
	function _0(e, t) {
		let r = '', n = e[t + 1];
		while (
			n === ' ' || n === '\t' || n === `
`
			|| n === '\r'
		) {
			if (
				n === '\r' && e[t + 2] !== `
`
			) break;
			if (
				n === `
`
			) {
				r += `
`;
			}
			t += 1, n = e[t + 1];
		}
		if (!r) r = ' ';
		return { fold: r, offset: t };
	}
	var C0 = {
		'0': '\x00',
		a: '\x07',
		b: '\b',
		e: '\x1B',
		f: '\f',
		n: `
`,
		r: '\r',
		t: '\t',
		v: '\v',
		N: '',
		_: ' ',
		L: '\u2028',
		P: '\u2029',
		' ': ' ',
		'"': '"',
		'/': '/',
		'\\': '\\',
		'\t': '\t',
	};
	function z0(e, t, r, n) {
		let i = e.substr(t, r), s = i.length === r && /^[0-9a-fA-F]+$/.test(i) ? parseInt(i, 16) : NaN;
		try {
			return String.fromCodePoint(s);
		} catch {
			let a = e.substr(t - 2, r + 2);
			return n(t - 2, 'BAD_DQ_ESCAPE', `Invalid escape sequence ${a}`), a;
		}
	}
	T0.resolveFlowScalar = k0;
});
var Lf = D(function(L0) {
	var Ft = W(), $f = ce(), E0 = Vs(), I0 = Js();
	function P0(e, t, r, n) {
		let { value: i, type: o, comment: s, range: a } = t.type === 'block-scalar'
				? E0.resolveBlockScalar(e, t, n)
				: I0.resolveFlowScalar(t, e.options.strict, n),
			c = r ? e.directives.tagName(r.source, (f) => n(r, 'TAG_RESOLVE_FAILED', f)) : null,
			u;
		if (e.options.stringKeys && e.atKey) u = e.schema[Ft.SCALAR];
		else if (c) u = O0(e.schema, i, c, r, n);
		else if (t.type === 'scalar') u = $0(e, i, t, n);
		else u = e.schema[Ft.SCALAR];
		let l;
		try {
			let f = u.resolve(i, (h) => n(r ?? t, 'TAG_RESOLVE_FAILED', h), e.options);
			l = Ft.isScalar(f) ? f : new $f.Scalar(f);
		} catch (f) {
			let h = f instanceof Error ? f.message : String(f);
			n(r ?? t, 'TAG_RESOLVE_FAILED', h), l = new $f.Scalar(i);
		}
		if (l.range = a, l.source = i, o) l.type = o;
		if (c) l.tag = c;
		if (u.format) l.format = u.format;
		if (s) l.comment = s;
		return l;
	}
	function O0(e, t, r, n, i) {
		if (r === '!') return e[Ft.SCALAR];
		let o = [];
		for (let a of e.tags) {
			if (!a.collection && a.tag === r) {
				if (a.default && a.test) o.push(a);
				else return a;
			}
		}
		for (let a of o) if (a.test?.test(t)) return a;
		let s = e.knownTags[r];
		if (s && !s.collection) return e.tags.push(Object.assign({}, s, { default: !1, test: void 0 })), s;
		return i(n, 'TAG_RESOLVE_FAILED', `Unresolved tag: ${r}`, r !== 'tag:yaml.org,2002:str'), e[Ft.SCALAR];
	}
	function $0({ atKey: e, directives: t, schema: r }, n, i, o) {
		let s = r.tags.find((a) => (a.default === !0 || e && a.default === 'key') && a.test?.test(n)) || r[Ft.SCALAR];
		if (r.compat) {
			let a = r.compat.find((c) => c.default && c.test?.test(n)) ?? r[Ft.SCALAR];
			if (s.tag !== a.tag) {
				let c = t.tagString(s.tag), u = t.tagString(a.tag), l = `Value may be parsed as either ${c} or ${u}`;
				o(i, 'TAG_RESOLVE_FAILED', l, !0);
			}
		}
		return s;
	}
	L0.composeScalar = P0;
});
var Nf = D(function(D0) {
	function q0(e, t, r) {
		if (t) {
			r ?? (r = t.length);
			for (let n = r - 1; n >= 0; --n) {
				let i = t[n];
				switch (i.type) {
					case 'space':
					case 'comment':
					case 'newline':
						e -= i.source.length;
						continue;
				}
				i = t[++n];
				while (i?.type === 'space') e += i.source.length, i = t[++n];
				break;
			}
		}
		return e;
	}
	D0.emptyScalarPosition = q0;
});
var Mf = D(function(K0) {
	var F0 = Fr(), R0 = W(), B0 = Pf(), qf = Lf(), Z0 = yr(), j0 = Nf(), U0 = { composeNode: Df, composeEmptyNode: Hs };
	function Df(e, t, r, n) {
		let i = e.atKey, { spaceBefore: o, comment: s, anchor: a, tag: c } = r, u, l = !0;
		switch (t.type) {
			case 'alias':
				if (u = V0(e, t, n), a || c) n(t, 'ALIAS_PROPS', 'An alias node must not specify any properties');
				break;
			case 'scalar':
			case 'single-quoted-scalar':
			case 'double-quoted-scalar':
			case 'block-scalar':
				if (u = qf.composeScalar(e, t, c, n), a) u.anchor = a.source.substring(1);
				break;
			case 'block-map':
			case 'block-seq':
			case 'flow-collection':
				try {
					if (u = B0.composeCollection(U0, e, t, r, n), a) u.anchor = a.source.substring(1);
				} catch (f) {
					let h = f instanceof Error ? f.message : String(f);
					n(t, 'RESOURCE_EXHAUSTION', h);
				}
				break;
			default: {
				let f = t.type === 'error' ? t.message : `Unsupported token (type: ${t.type})`;
				n(t, 'UNEXPECTED_TOKEN', f), l = !1;
			}
		}
		if (u ?? (u = Hs(e, t.offset, void 0, null, r, n)), a && u.anchor === '') {
			n(a, 'BAD_ALIAS', 'Anchor cannot be an empty string');
		}
		if (
			i && e.options.stringKeys
			&& (!R0.isScalar(u) || typeof u.value !== 'string' || u.tag && u.tag !== 'tag:yaml.org,2002:str')
		) n(c ?? t, 'NON_STRING_KEY', 'With stringKeys, all keys must be strings');
		if (o) u.spaceBefore = !0;
		if (s) {
			if (t.type === 'scalar' && t.source === '') u.comment = s;
			else u.commentBefore = s;
		}
		if (e.options.keepSourceTokens && l) u.srcToken = t;
		return u;
	}
	function Hs(e, t, r, n, { spaceBefore: i, comment: o, anchor: s, tag: a, end: c }, u) {
		let l = { type: 'scalar', offset: j0.emptyScalarPosition(t, r, n), indent: -1, source: '' },
			f = qf.composeScalar(e, l, a, u);
		if (s) {
			if (f.anchor = s.source.substring(1), f.anchor === '') u(s, 'BAD_ALIAS', 'Anchor cannot be an empty string');
		}
		if (i) f.spaceBefore = !0;
		if (o) f.comment = o, f.range[2] = c;
		return f;
	}
	function V0({ options: e }, { offset: t, source: r, end: n }, i) {
		let o = new F0.Alias(r.substring(1));
		if (o.source === '') i(t, 'BAD_ALIAS', 'Alias cannot be an empty string');
		if (o.source.endsWith(':')) i(t + r.length - 1, 'BAD_ALIAS', 'Alias ending in : is ambiguous', !0);
		let s = t + r.length, a = Z0.resolveEnd(n, s, e.strict, i);
		if (o.range = [t, s, a.offset], a.comment) o.comment = a.comment;
		return o;
	}
	K0.composeEmptyNode = Hs;
	K0.composeNode = Df;
});
var Rf = D(function(X0) {
	var G0 = Xr(), Ff = Mf(), W0 = yr(), Y0 = tn();
	function Q0(e, t, { offset: r, start: n, value: i, end: o }, s) {
		let a = Object.assign({ _directives: t }, e),
			c = new G0.Document(void 0, a),
			u = { atKey: !1, atRoot: !0, directives: c.directives, options: c.options, schema: c.schema },
			l = Y0.resolveProps(n, {
				indicator: 'doc-start',
				next: i ?? o?.[0],
				offset: r,
				onError: s,
				parentIndent: 0,
				startOnNewline: !0,
			});
		if (l.found) {
			if (c.directives.docStart = !0, i && (i.type === 'block-map' || i.type === 'block-seq') && !l.hasNewline) {
				s(l.end, 'MISSING_CHAR', 'Block collection cannot start on same line with directives-end marker');
			}
		}
		c.contents = i ? Ff.composeNode(u, i, l, s) : Ff.composeEmptyNode(u, l.end, n, null, l, s);
		let f = c.contents.range[2], h = W0.resolveEnd(o, f, !1, s);
		if (h.comment) c.comment = h.comment;
		return c.range = [r, f, h.offset], c;
	}
	X0.composeDoc = Q0;
});
var Gs = D(function(s1) {
	var t1 = ar('process'), r1 = Xo(), n1 = Xr(), rn = en(), Bf = W(), i1 = Rf(), o1 = yr();
	function nn(e) {
		if (typeof e === 'number') return [e, e + 1];
		if (Array.isArray(e)) return e.length === 2 ? e : [e[0], e[1]];
		let { offset: t, source: r } = e;
		return [t, t + (typeof r === 'string' ? r.length : 1)];
	}
	function Zf(e) {
		let t = '', r = !1, n = !1;
		for (let i = 0; i < e.length; ++i) {
			let o = e[i];
			switch (o[0]) {
				case '#':
					t += (t === '' ? '' : n
						? `

`
						: `
`) + (o.substring(1) || ' '),
						r = !0,
						n = !1;
					break;
				case '%':
					if (e[i + 1]?.[0] !== '#') i += 1;
					r = !1;
					break;
				default:
					if (!r) n = !0;
					r = !1;
			}
		}
		return { comment: t, afterEmptyLine: n };
	}
	class jf {
		constructor(e = {}) {
			this.doc = null,
				this.atDirectives = !1,
				this.prelude = [],
				this.errors = [],
				this.warnings = [],
				this.onError = (t, r, n, i) => {
					let o = nn(t);
					if (i) this.warnings.push(new rn.YAMLWarning(o, r, n));
					else this.errors.push(new rn.YAMLParseError(o, r, n));
				},
				this.directives = new r1.Directives({ version: e.version || '1.2' }),
				this.options = e;
		}
		decorate(e, t) {
			let { comment: r, afterEmptyLine: n } = Zf(this.prelude);
			if (r) {
				let i = e.contents;
				if (t) {
					e.comment = e.comment
						? `${e.comment}
${r}`
						: r;
				} else if (n || e.directives.docStart || !i) e.commentBefore = r;
				else if (Bf.isCollection(i) && !i.flow && i.items.length > 0) {
					let o = i.items[0];
					if (Bf.isPair(o)) o = o.key;
					let s = o.commentBefore;
					o.commentBefore = s
						? `${r}
${s}`
						: r;
				} else {
					let o = i.commentBefore;
					i.commentBefore = o
						? `${r}
${o}`
						: r;
				}
			}
			if (t) {
				for (let i = 0; i < this.errors.length; ++i) e.errors.push(this.errors[i]);
				for (let i = 0; i < this.warnings.length; ++i) e.warnings.push(this.warnings[i]);
			} else e.errors = this.errors, e.warnings = this.warnings;
			this.prelude = [], this.errors = [], this.warnings = [];
		}
		streamInfo() {
			return {
				comment: Zf(this.prelude).comment,
				directives: this.directives,
				errors: this.errors,
				warnings: this.warnings,
			};
		}
		*compose(e, t = !1, r = -1) {
			for (let n of e) yield* this.next(n);
			yield* this.end(t, r);
		}
		*next(e) {
			if (t1.env.LOG_STREAM) console.dir(e, { depth: null });
			switch (e.type) {
				case 'directive':
					this.directives.add(e.source, (t, r, n) => {
						let i = nn(e);
						i[0] += t, this.onError(i, 'BAD_DIRECTIVE', r, n);
					}),
						this.prelude.push(e.source),
						this.atDirectives = !0;
					break;
				case 'document': {
					let t = i1.composeDoc(this.options, this.directives, e, this.onError);
					if (this.atDirectives && !t.directives.docStart) {
						this.onError(e, 'MISSING_CHAR', 'Missing directives-end/doc-start indicator line');
					}
					if (this.decorate(t, !1), this.doc) yield this.doc;
					this.doc = t, this.atDirectives = !1;
					break;
				}
				case 'byte-order-mark':
				case 'space':
					break;
				case 'comment':
				case 'newline':
					this.prelude.push(e.source);
					break;
				case 'error': {
					let t = e.source ? `${e.message}: ${JSON.stringify(e.source)}` : e.message,
						r = new rn.YAMLParseError(nn(e), 'UNEXPECTED_TOKEN', t);
					if (this.atDirectives || !this.doc) this.errors.push(r);
					else this.doc.errors.push(r);
					break;
				}
				case 'doc-end': {
					if (!this.doc) {
						this.errors.push(
							new rn.YAMLParseError(nn(e), 'UNEXPECTED_TOKEN', 'Unexpected doc-end without preceding document'),
						);
						break;
					}
					this.doc.directives.docEnd = !0;
					let t = o1.resolveEnd(e.end, e.offset + e.source.length, this.doc.options.strict, this.onError);
					if (this.decorate(this.doc, !0), t.comment) {
						let r = this.doc.comment;
						this.doc.comment = r
							? `${r}
${t.comment}`
							: t.comment;
					}
					this.doc.range[2] = t.offset;
					break;
				}
				default:
					this.errors.push(new rn.YAMLParseError(nn(e), 'UNEXPECTED_TOKEN', `Unsupported token ${e.type}`));
			}
		}
		*end(e = !1, t = -1) {
			if (this.doc) this.decorate(this.doc, !0), yield this.doc, this.doc = null;
			else if (e) {
				let r = Object.assign({ _directives: this.directives }, this.options), n = new n1.Document(void 0, r);
				if (this.atDirectives) this.onError(t, 'MISSING_CHAR', 'Missing directives-end indicator line');
				n.range = [0, t, t], this.decorate(n, !1), yield n;
			}
		}
	}
	s1.Composer = jf;
});
var Kf = D(function(m1) {
	var c1 = Vs(), u1 = Js(), l1 = en(), Uf = jr();
	function f1(e, t = !0, r) {
		if (e) {
			let n = (i, o, s) => {
				let a = typeof i === 'number' ? i : Array.isArray(i) ? i[0] : i.offset;
				if (r) r(a, o, s);
				else throw new l1.YAMLParseError([a, a + 1], o, s);
			};
			switch (e.type) {
				case 'scalar':
				case 'single-quoted-scalar':
				case 'double-quoted-scalar':
					return u1.resolveFlowScalar(e, t, n);
				case 'block-scalar':
					return c1.resolveBlockScalar({ options: { strict: t } }, e, n);
			}
		}
		return null;
	}
	function p1(e, t) {
		let { implicitKey: r = !1, indent: n, inFlow: i = !1, offset: o = -1, type: s = 'PLAIN' } = t,
			a = Uf.stringifyString({ type: s, value: e }, {
				implicitKey: r,
				indent: n > 0 ? ' '.repeat(n) : '',
				inFlow: i,
				options: { blockQuote: !0, lineWidth: -1 },
			}),
			c = t.end ?? [{
				type: 'newline',
				offset: -1,
				indent: n,
				source: `
`,
			}];
		switch (a[0]) {
			case '|':
			case '>': {
				let u = a.indexOf(`
`),
					l = a.substring(0, u),
					f = a.substring(u + 1) + `
`,
					h = [{ type: 'block-scalar-header', offset: o, indent: n, source: l }];
				if (!Vf(h, c)) {
					h.push({
						type: 'newline',
						offset: -1,
						indent: n,
						source: `
`,
					});
				}
				return { type: 'block-scalar', offset: o, indent: n, props: h, source: f };
			}
			case '"':
				return { type: 'double-quoted-scalar', offset: o, indent: n, source: a, end: c };
			case "'":
				return { type: 'single-quoted-scalar', offset: o, indent: n, source: a, end: c };
			default:
				return { type: 'scalar', offset: o, indent: n, source: a, end: c };
		}
	}
	function h1(e, t, r = {}) {
		let { afterKey: n = !1, implicitKey: i = !1, inFlow: o = !1, type: s } = r, a = 'indent' in e ? e.indent : null;
		if (n && typeof a === 'number') a += 2;
		if (!s) {
			switch (e.type) {
				case 'single-quoted-scalar':
					s = 'QUOTE_SINGLE';
					break;
				case 'double-quoted-scalar':
					s = 'QUOTE_DOUBLE';
					break;
				case 'block-scalar': {
					let u = e.props[0];
					if (u.type !== 'block-scalar-header') throw Error('Invalid block scalar header');
					s = u.source[0] === '>' ? 'BLOCK_FOLDED' : 'BLOCK_LITERAL';
					break;
				}
				default:
					s = 'PLAIN';
			}
		}
		let c = Uf.stringifyString({ type: s, value: t }, {
			implicitKey: i || a === null,
			indent: a !== null && a > 0 ? ' '.repeat(a) : '',
			inFlow: o,
			options: { blockQuote: !0, lineWidth: -1 },
		});
		switch (c[0]) {
			case '|':
			case '>':
				d1(e, c);
				break;
			case '"':
				Ws(e, c, 'double-quoted-scalar');
				break;
			case "'":
				Ws(e, c, 'single-quoted-scalar');
				break;
			default:
				Ws(e, c, 'scalar');
		}
	}
	function d1(e, t) {
		let r = t.indexOf(`
`),
			n = t.substring(0, r),
			i = t.substring(r + 1) + `
`;
		if (e.type === 'block-scalar') {
			let o = e.props[0];
			if (o.type !== 'block-scalar-header') throw Error('Invalid block scalar header');
			o.source = n, e.source = i;
		} else {
			let { offset: o } = e,
				s = 'indent' in e ? e.indent : -1,
				a = [{ type: 'block-scalar-header', offset: o, indent: s, source: n }];
			if (!Vf(a, 'end' in e ? e.end : void 0)) {
				a.push({
					type: 'newline',
					offset: -1,
					indent: s,
					source: `
`,
				});
			}
			for (let c of Object.keys(e)) if (c !== 'type' && c !== 'offset') delete e[c];
			Object.assign(e, { type: 'block-scalar', indent: s, props: a, source: i });
		}
	}
	function Vf(e, t) {
		if (t) {
			for (let r of t) {
				switch (r.type) {
					case 'space':
					case 'comment':
						e.push(r);
						break;
					case 'newline':
						return e.push(r), !0;
				}
			}
		}
		return !1;
	}
	function Ws(e, t, r) {
		switch (e.type) {
			case 'scalar':
			case 'double-quoted-scalar':
			case 'single-quoted-scalar':
				e.type = r, e.source = t;
				break;
			case 'block-scalar': {
				let n = e.props.slice(1), i = t.length;
				if (e.props[0].type === 'block-scalar-header') i -= e.props[0].source.length;
				for (let o of n) o.offset += i;
				delete e.props, Object.assign(e, { type: r, source: t, end: n });
				break;
			}
			case 'block-map':
			case 'block-seq': {
				let i = {
					type: 'newline',
					offset: e.offset + t.length,
					indent: e.indent,
					source: `
`,
				};
				delete e.items, Object.assign(e, { type: r, source: t, end: [i] });
				break;
			}
			default: {
				let n = 'indent' in e ? e.indent : -1,
					i = 'end' in e && Array.isArray(e.end)
						? e.end.filter((o) => o.type === 'space' || o.type === 'comment' || o.type === 'newline')
						: [];
				for (let o of Object.keys(e)) if (o !== 'type' && o !== 'offset') delete e[o];
				Object.assign(e, { type: r, indent: n, source: t, end: i });
			}
		}
	}
	m1.createScalarToken = p1;
	m1.resolveAsScalar = f1;
	m1.setScalarValue = h1;
});
var Jf = D(function(k1) {
	var x1 = (e) => ('type' in e) ? vi(e) : Si(e);
	function vi(e) {
		switch (e.type) {
			case 'block-scalar': {
				let t = '';
				for (let r of e.props) t += vi(r);
				return t + e.source;
			}
			case 'block-map':
			case 'block-seq': {
				let t = '';
				for (let r of e.items) t += Si(r);
				return t;
			}
			case 'flow-collection': {
				let t = e.start.source;
				for (let r of e.items) t += Si(r);
				for (let r of e.end) t += r.source;
				return t;
			}
			case 'document': {
				let t = Si(e);
				if (e.end) { for (let r of e.end) t += r.source; }
				return t;
			}
			default: {
				let t = e.source;
				if ('end' in e && e.end) { for (let r of e.end) t += r.source; }
				return t;
			}
		}
	}
	function Si({ start: e, key: t, sep: r, value: n }) {
		let i = '';
		for (let o of e) i += o.source;
		if (t) i += vi(t);
		if (r) { for (let o of r) i += o.source; }
		if (n) i += vi(n);
		return i;
	}
	k1.stringify = x1;
});
var Wf = D(function(v1) {
	var Ys = Symbol('break visit'), S1 = Symbol('skip children'), Hf = Symbol('remove item');
	function Rt(e, t) {
		if ('type' in e && e.type === 'document') e = { start: e.start, value: e.value };
		Gf(Object.freeze([]), e, t);
	}
	Rt.BREAK = Ys;
	Rt.SKIP = S1;
	Rt.REMOVE = Hf;
	Rt.itemAtPath = (e, t) => {
		let r = e;
		for (let [n, i] of t) {
			let o = r?.[n];
			if (o && 'items' in o) r = o.items[i];
			else return;
		}
		return r;
	};
	Rt.parentCollection = (e, t) => {
		let r = Rt.itemAtPath(e, t.slice(0, -1)), n = t[t.length - 1][0], i = r?.[n];
		if (i && 'items' in i) return i;
		throw Error('Parent collection not found');
	};
	function Gf(e, t, r) {
		let n = r(t, e);
		if (typeof n === 'symbol') return n;
		for (let i of ['key', 'value']) {
			let o = t[i];
			if (o && 'items' in o) {
				for (let s = 0; s < o.items.length; ++s) {
					let a = Gf(Object.freeze(e.concat([[i, s]])), o.items[s], r);
					if (typeof a === 'number') s = a - 1;
					else if (a === Ys) return Ys;
					else if (a === Hf) o.items.splice(s, 1), s -= 1;
				}
				if (typeof n === 'function' && i === 'key') n = n(t, e);
			}
		}
		return typeof n === 'function' ? n(t, e) : n;
	}
	v1.visit = Rt;
});
var _i = D(function(P1) {
	var Qs = Kf(),
		C1 = Jf(),
		z1 = Wf(),
		Xs = '\uFEFF',
		ea = '\x02',
		ta = '\x18',
		ra = '\x1F',
		T1 = (e) => !!e && ('items' in e),
		A1 = (e) =>
			!!e
			&& (e.type === 'scalar' || e.type === 'single-quoted-scalar' || e.type === 'double-quoted-scalar'
				|| e.type === 'block-scalar');
	function E1(e) {
		switch (e) {
			case Xs:
				return '<BOM>';
			case ea:
				return '<DOC>';
			case ta:
				return '<FLOW_END>';
			case ra:
				return '<SCALAR>';
			default:
				return JSON.stringify(e);
		}
	}
	function I1(e) {
		switch (e) {
			case Xs:
				return 'byte-order-mark';
			case ea:
				return 'doc-mode';
			case ta:
				return 'flow-error-end';
			case ra:
				return 'scalar';
			case '---':
				return 'doc-start';
			case '...':
				return 'doc-end';
			case '':
			case `
`:
			case `\r
`:
				return 'newline';
			case '-':
				return 'seq-item-ind';
			case '?':
				return 'explicit-key-ind';
			case ':':
				return 'map-value-ind';
			case '{':
				return 'flow-map-start';
			case '}':
				return 'flow-map-end';
			case '[':
				return 'flow-seq-start';
			case ']':
				return 'flow-seq-end';
			case ',':
				return 'comma';
		}
		switch (e[0]) {
			case ' ':
			case '\t':
				return 'space';
			case '#':
				return 'comment';
			case '%':
				return 'directive-line';
			case '*':
				return 'alias';
			case '&':
				return 'anchor';
			case '!':
				return 'tag';
			case "'":
				return 'single-quoted-scalar';
			case '"':
				return 'double-quoted-scalar';
			case '|':
			case '>':
				return 'block-scalar-header';
		}
		return null;
	}
	P1.createScalarToken = Qs.createScalarToken;
	P1.resolveAsScalar = Qs.resolveAsScalar;
	P1.setScalarValue = Qs.setScalarValue;
	P1.stringify = C1.stringify;
	P1.visit = z1.visit;
	P1.BOM = Xs;
	P1.DOCUMENT = ea;
	P1.FLOW_END = ta;
	P1.SCALAR = ra;
	P1.isCollection = T1;
	P1.isScalar = A1;
	P1.prettyToken = E1;
	P1.tokenType = I1;
});
var ia = D(function(J1) {
	var on = _i();
	function Me(e) {
		switch (e) {
			case void 0:
			case ' ':
			case `
`:
			case '\r':
			case '\t':
				return !0;
			default:
				return !1;
		}
	}
	var Yf = new Set('0123456789ABCDEFabcdef'),
		V1 = new Set("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-#;/?:@&=+$_.!~*'()"),
		Ci = new Set(',[]{}'),
		K1 = new Set(` ,[]{}
\r	`),
		na = (e) => !e || K1.has(e);
	class Qf {
		constructor() {
			this.atEnd = !1,
				this.blockScalarIndent = -1,
				this.blockScalarKeep = !1,
				this.buffer = '',
				this.flowKey = !1,
				this.flowLevel = 0,
				this.indentNext = 0,
				this.indentValue = 0,
				this.lineEndPos = null,
				this.next = null,
				this.pos = 0;
		}
		*lex(e, t = !1) {
			if (e) {
				if (typeof e !== 'string') throw TypeError('source is not a string');
				this.buffer = this.buffer ? this.buffer + e : e, this.lineEndPos = null;
			}
			this.atEnd = !t;
			let r = this.next ?? 'stream';
			while (r && (t || this.hasChars(1))) r = yield* this.parseNext(r);
		}
		atLineEnd() {
			let e = this.pos, t = this.buffer[e];
			while (t === ' ' || t === '\t') t = this.buffer[++e];
			if (
				!t || t === '#' || t === `
`
			) return !0;
			if (t === '\r') {
				return this.buffer[e + 1] === `
`;
			}
			return !1;
		}
		charAt(e) {
			return this.buffer[this.pos + e];
		}
		continueScalar(e) {
			let t = this.buffer[e];
			if (this.indentNext > 0) {
				let r = 0;
				while (t === ' ') t = this.buffer[++r + e];
				if (t === '\r') {
					let n = this.buffer[r + e + 1];
					if (
						n === `
` || !n && !this.atEnd
					) return e + r + 1;
				}
				return t === `
` || r >= this.indentNext || !t && !this.atEnd
					? e + r
					: -1;
			}
			if (t === '-' || t === '.') {
				let r = this.buffer.substr(e, 3);
				if ((r === '---' || r === '...') && Me(this.buffer[e + 3])) return -1;
			}
			return e;
		}
		getLine() {
			let e = this.lineEndPos;
			if (typeof e !== 'number' || e !== -1 && e < this.pos) {
				e = this.buffer.indexOf(
					`
`,
					this.pos,
				), this.lineEndPos = e;
			}
			if (e === -1) return this.atEnd ? this.buffer.substring(this.pos) : null;
			if (this.buffer[e - 1] === '\r') e -= 1;
			return this.buffer.substring(this.pos, e);
		}
		hasChars(e) {
			return this.pos + e <= this.buffer.length;
		}
		setNext(e) {
			return this.buffer = this.buffer.substring(this.pos), this.pos = 0, this.lineEndPos = null, this.next = e, null;
		}
		peek(e) {
			return this.buffer.substr(this.pos, e);
		}
		*parseNext(e) {
			switch (e) {
				case 'stream':
					return yield* this.parseStream();
				case 'line-start':
					return yield* this.parseLineStart();
				case 'block-start':
					return yield* this.parseBlockStart();
				case 'doc':
					return yield* this.parseDocument();
				case 'flow':
					return yield* this.parseFlowCollection();
				case 'quoted-scalar':
					return yield* this.parseQuotedScalar();
				case 'block-scalar':
					return yield* this.parseBlockScalar();
				case 'plain-scalar':
					return yield* this.parsePlainScalar();
			}
		}
		*parseStream() {
			let e = this.getLine();
			if (e === null) return this.setNext('stream');
			if (e[0] === on.BOM) yield* this.pushCount(1), e = e.substring(1);
			if (e[0] === '%') {
				let t = e.length, r = e.indexOf('#');
				while (r !== -1) {
					let i = e[r - 1];
					if (i === ' ' || i === '\t') {
						t = r - 1;
						break;
					} else r = e.indexOf('#', r + 1);
				}
				while (!0) {
					let i = e[t - 1];
					if (i === ' ' || i === '\t') t -= 1;
					else break;
				}
				let n = (yield* this.pushCount(t)) + (yield* this.pushSpaces(!0));
				return yield* this.pushCount(e.length - n), this.pushNewline(), 'stream';
			}
			if (this.atLineEnd()) {
				let t = yield* this.pushSpaces(!0);
				return yield* this.pushCount(e.length - t), yield* this.pushNewline(), 'stream';
			}
			return yield on.DOCUMENT, yield* this.parseLineStart();
		}
		*parseLineStart() {
			let e = this.charAt(0);
			if (!e && !this.atEnd) return this.setNext('line-start');
			if (e === '-' || e === '.') {
				if (!this.atEnd && !this.hasChars(4)) return this.setNext('line-start');
				let t = this.peek(3);
				if ((t === '---' || t === '...') && Me(this.charAt(3))) {
					return yield* this.pushCount(3), this.indentValue = 0, this.indentNext = 0, t === '---' ? 'doc' : 'stream';
				}
			}
			if (this.indentValue = yield* this.pushSpaces(!1), this.indentNext > this.indentValue && !Me(this.charAt(1))) {
				this.indentNext = this.indentValue;
			}
			return yield* this.parseBlockStart();
		}
		*parseBlockStart() {
			let [e, t] = this.peek(2);
			if (!t && !this.atEnd) return this.setNext('block-start');
			if ((e === '-' || e === '?' || e === ':') && Me(t)) {
				let r = (yield* this.pushCount(1)) + (yield* this.pushSpaces(!0));
				return this.indentNext = this.indentValue + 1, this.indentValue += r, 'block-start';
			}
			return 'doc';
		}
		*parseDocument() {
			yield* this.pushSpaces(!0);
			let e = this.getLine();
			if (e === null) return this.setNext('doc');
			let t = yield* this.pushIndicators();
			switch (e[t]) {
				case '#':
					yield* this.pushCount(e.length - t);
				case void 0:
					return yield* this.pushNewline(), yield* this.parseLineStart();
				case '{':
				case '[':
					return yield* this.pushCount(1), this.flowKey = !1, this.flowLevel = 1, 'flow';
				case '}':
				case ']':
					return yield* this.pushCount(1), 'doc';
				case '*':
					return yield* this.pushUntil(na), 'doc';
				case '"':
				case "'":
					return yield* this.parseQuotedScalar();
				case '|':
				case '>':
					return t += yield* this.parseBlockScalarHeader(),
						t += yield* this.pushSpaces(!0),
						yield* this.pushCount(e.length - t),
						yield* this.pushNewline(),
						yield* this.parseBlockScalar();
				default:
					return yield* this.parsePlainScalar();
			}
		}
		*parseFlowCollection() {
			let e, t, r = -1;
			do {
				if (e = yield* this.pushNewline(), e > 0) t = yield* this.pushSpaces(!1), this.indentValue = r = t;
				else t = 0;
				t += yield* this.pushSpaces(!0);
			} while (e + t > 0);
			let n = this.getLine();
			if (n === null) return this.setNext('flow');
			if (
				r !== -1 && r < this.indentNext && n[0] !== '#'
				|| r === 0 && (n.startsWith('---') || n.startsWith('...')) && Me(n[3])
			) {
				if (!(r === this.indentNext - 1 && this.flowLevel === 1 && (n[0] === ']' || n[0] === '}'))) {
					return this.flowLevel = 0, yield on.FLOW_END, yield* this.parseLineStart();
				}
			}
			let i = 0;
			while (n[i] === ',') i += yield* this.pushCount(1), i += yield* this.pushSpaces(!0), this.flowKey = !1;
			switch (i += yield* this.pushIndicators(), n[i]) {
				case void 0:
					return 'flow';
				case '#':
					return yield* this.pushCount(n.length - i), 'flow';
				case '{':
				case '[':
					return yield* this.pushCount(1), this.flowKey = !1, this.flowLevel += 1, 'flow';
				case '}':
				case ']':
					return yield* this.pushCount(1), this.flowKey = !0, this.flowLevel -= 1, this.flowLevel ? 'flow' : 'doc';
				case '*':
					return yield* this.pushUntil(na), 'flow';
				case '"':
				case "'":
					return this.flowKey = !0, yield* this.parseQuotedScalar();
				case ':': {
					let o = this.charAt(1);
					if (this.flowKey || Me(o) || o === ',') {
						return this.flowKey = !1, yield* this.pushCount(1), yield* this.pushSpaces(!0), 'flow';
					}
				}
				default:
					return this.flowKey = !1, yield* this.parsePlainScalar();
			}
		}
		*parseQuotedScalar() {
			let e = this.charAt(0), t = this.buffer.indexOf(e, this.pos + 1);
			if (e === "'") { while (t !== -1 && this.buffer[t + 1] === "'") t = this.buffer.indexOf("'", t + 2); }
			else {while (t !== -1) {
					let i = 0;
					while (this.buffer[t - 1 - i] === '\\') i += 1;
					if (i % 2 === 0) break;
					t = this.buffer.indexOf('"', t + 1);
				}}
			let r = this.buffer.substring(0, t),
				n = r.indexOf(
					`
`,
					this.pos,
				);
			if (n !== -1) {
				while (n !== -1) {
					let i = this.continueScalar(n + 1);
					if (i === -1) break;
					n = r.indexOf(
						`
`,
						i,
					);
				}
				if (n !== -1) t = n - (r[n - 1] === '\r' ? 2 : 1);
			}
			if (t === -1) {
				if (!this.atEnd) return this.setNext('quoted-scalar');
				t = this.buffer.length;
			}
			return yield* this.pushToIndex(t + 1, !1), this.flowLevel ? 'flow' : 'doc';
		}
		*parseBlockScalarHeader() {
			this.blockScalarIndent = -1, this.blockScalarKeep = !1;
			let e = this.pos;
			while (!0) {
				let t = this.buffer[++e];
				if (t === '+') this.blockScalarKeep = !0;
				else if (t > '0' && t <= '9') this.blockScalarIndent = Number(t) - 1;
				else if (t !== '-') break;
			}
			return yield* this.pushUntil((t) => Me(t) || t === '#');
		}
		*parseBlockScalar() {
			let e = this.pos - 1, t = 0, r;
			e: for (let i = this.pos; r = this.buffer[i]; ++i) {
				switch (r) {
					case ' ':
						t += 1;
						break;
					case `
`:
						e = i, t = 0;
						break;
					case '\r': {
						let o = this.buffer[i + 1];
						if (!o && !this.atEnd) return this.setNext('block-scalar');
						if (
							o === `
`
						) break;
					}
					default:
						break e;
				}
			}
			if (!r && !this.atEnd) return this.setNext('block-scalar');
			if (t >= this.indentNext) {
				if (this.blockScalarIndent === -1) this.indentNext = t;
				else this.indentNext = this.blockScalarIndent + (this.indentNext === 0 ? 1 : this.indentNext);
				do {
					let i = this.continueScalar(e + 1);
					if (i === -1) break;
					e = this.buffer.indexOf(
						`
`,
						i,
					);
				} while (e !== -1);
				if (e === -1) {
					if (!this.atEnd) return this.setNext('block-scalar');
					e = this.buffer.length;
				}
			}
			let n = e + 1;
			r = this.buffer[n];
			while (r === ' ') r = this.buffer[++n];
			if (r === '\t') {
				while (
					r === '\t' || r === ' ' || r === '\r' || r === `
`
				) r = this.buffer[++n];
				e = n - 1;
			} else if (!this.blockScalarKeep) {
				do {
					let i = e - 1, o = this.buffer[i];
					if (o === '\r') o = this.buffer[--i];
					let s = i;
					while (o === ' ') o = this.buffer[--i];
					if (
						o === `
` && i >= this.pos && i + 1 + t > s
					) e = i;
					else break;
				} while (!0);
			}
			return yield on.SCALAR, yield* this.pushToIndex(e + 1, !0), yield* this.parseLineStart();
		}
		*parsePlainScalar() {
			let e = this.flowLevel > 0, t = this.pos - 1, r = this.pos - 1, n;
			while (n = this.buffer[++r]) {
				if (n === ':') {
					let i = this.buffer[r + 1];
					if (Me(i) || e && Ci.has(i)) break;
					t = r;
				} else if (Me(n)) {
					let i = this.buffer[r + 1];
					if (n === '\r') {
						if (
							i === `
`
						) {
							r += 1,
								n = `
`,
								i = this.buffer[r + 1];
						} else t = r;
					}
					if (i === '#' || e && Ci.has(i)) break;
					if (
						n === `
`
					) {
						let o = this.continueScalar(r + 1);
						if (o === -1) break;
						r = Math.max(r, o - 2);
					}
				} else {
					if (e && Ci.has(n)) break;
					t = r;
				}
			}
			if (!n && !this.atEnd) return this.setNext('plain-scalar');
			return yield on.SCALAR, yield* this.pushToIndex(t + 1, !0), e ? 'flow' : 'doc';
		}
		*pushCount(e) {
			if (e > 0) return yield this.buffer.substr(this.pos, e), this.pos += e, e;
			return 0;
		}
		*pushToIndex(e, t) {
			let r = this.buffer.slice(this.pos, e);
			if (r) return yield r, this.pos += r.length, r.length;
			else if (t) yield '';
			return 0;
		}
		*pushIndicators() {
			let e = 0;
			e: while (!0) {
				switch (this.charAt(0)) {
					case '!':
						e += yield* this.pushTag(), e += yield* this.pushSpaces(!0);
						continue e;
					case '&':
						e += yield* this.pushUntil(na), e += yield* this.pushSpaces(!0);
						continue e;
					case '-':
					case '?':
					case ':': {
						let t = this.flowLevel > 0, r = this.charAt(1);
						if (Me(r) || t && Ci.has(r)) {
							if (!t) this.indentNext = this.indentValue + 1;
							else if (this.flowKey) this.flowKey = !1;
							e += yield* this.pushCount(1), e += yield* this.pushSpaces(!0);
							continue e;
						}
					}
				}
				break e;
			}
			return e;
		}
		*pushTag() {
			if (this.charAt(1) === '<') {
				let e = this.pos + 2, t = this.buffer[e];
				while (!Me(t) && t !== '>') t = this.buffer[++e];
				return yield* this.pushToIndex(t === '>' ? e + 1 : e, !1);
			} else {
				let e = this.pos + 1, t = this.buffer[e];
				while (t) {
					if (V1.has(t)) t = this.buffer[++e];
					else if (t === '%' && Yf.has(this.buffer[e + 1]) && Yf.has(this.buffer[e + 2])) t = this.buffer[e += 3];
					else break;
				}
				return yield* this.pushToIndex(e, !1);
			}
		}
		*pushNewline() {
			let e = this.buffer[this.pos];
			if (
				e === `
`
			) return yield* this.pushCount(1);
			else if (
				e === '\r' && this.charAt(1) === `
`
			) return yield* this.pushCount(2);
			else return 0;
		}
		*pushSpaces(e) {
			let t = this.pos - 1, r;
			do r = this.buffer[++t]; while (r === ' ' || e && r === '\t');
			let n = t - this.pos;
			if (n > 0) yield this.buffer.substr(this.pos, n), this.pos = t;
			return n;
		}
		*pushUntil(e) {
			let t = this.pos, r = this.buffer[t];
			while (!e(r)) r = this.buffer[++t];
			return yield* this.pushToIndex(t, !1);
		}
	}
	J1.Lexer = Qf;
});
var oa = D(function(G1) {
	class Xf {
		constructor() {
			this.lineStarts = [],
				this.addNewLine = (e) => this.lineStarts.push(e),
				this.linePos = (e) => {
					let t = 0, r = this.lineStarts.length;
					while (t < r) {
						let i = t + r >> 1;
						if (this.lineStarts[i] < e) t = i + 1;
						else r = i;
					}
					if (this.lineStarts[t] === e) return { line: t + 1, col: 1 };
					if (t === 0) return { line: 0, col: e };
					let n = this.lineStarts[t - 1];
					return { line: t, col: e - n + 1 };
				};
		}
	}
	G1.LineCounter = Xf;
});
var sa = D(function(X1) {
	var Y1 = ar('process'), ep = _i(), Q1 = ia();
	function bt(e, t) {
		for (let r = 0; r < e.length; ++r) if (e[r].type === t) return !0;
		return !1;
	}
	function tp(e) {
		for (let t = 0; t < e.length; ++t) {
			switch (e[t].type) {
				case 'space':
				case 'comment':
				case 'newline':
					break;
				default:
					return t;
			}
		}
		return -1;
	}
	function np(e) {
		switch (e?.type) {
			case 'alias':
			case 'scalar':
			case 'single-quoted-scalar':
			case 'double-quoted-scalar':
			case 'flow-collection':
				return !0;
			default:
				return !1;
		}
	}
	function zi(e) {
		switch (e.type) {
			case 'document':
				return e.start;
			case 'block-map': {
				let t = e.items[e.items.length - 1];
				return t.sep ?? t.start;
			}
			case 'block-seq':
				return e.items[e.items.length - 1].start;
			default:
				return [];
		}
	}
	function br(e) {
		if (e.length === 0) return [];
		let t = e.length;
		e: while (--t >= 0) {
			switch (e[t].type) {
				case 'doc-start':
				case 'explicit-key-ind':
				case 'map-value-ind':
				case 'seq-item-ind':
				case 'newline':
					break e;
			}
		}
		while (e[++t]?.type === 'space');
		return e.splice(t, e.length);
	}
	function Ti(e, t) {
		if (t.length < 1e5) Array.prototype.push.apply(e, t);
		else for (let r = 0; r < t.length; ++r) e.push(t[r]);
	}
	function rp(e) {
		if (e.start.type === 'flow-seq-start') {
			for (let t of e.items) {
				if (t.sep && !t.value && !bt(t.start, 'explicit-key-ind') && !bt(t.sep, 'map-value-ind')) {
					if (t.key) t.value = t.key;
					if (delete t.key, np(t.value)) {
						if (t.value.end) Ti(t.value.end, t.sep);
						else t.value.end = t.sep;
					} else Ti(t.start, t.sep);
					delete t.sep;
				}
			}
		}
	}
	class ip {
		constructor(e) {
			this.atNewLine = !0,
				this.atScalar = !1,
				this.indent = 0,
				this.offset = 0,
				this.onKeyLine = !1,
				this.stack = [],
				this.source = '',
				this.type = '',
				this.lexer = new Q1.Lexer(),
				this.onNewLine = e;
		}
		*parse(e, t = !1) {
			if (this.onNewLine && this.offset === 0) this.onNewLine(0);
			for (let r of this.lexer.lex(e, t)) yield* this.next(r);
			if (!t) yield* this.end();
		}
		*next(e) {
			if (this.source = e, Y1.env.LOG_TOKENS) console.log('|', ep.prettyToken(e));
			if (this.atScalar) {
				this.atScalar = !1, yield* this.step(), this.offset += e.length;
				return;
			}
			let t = ep.tokenType(e);
			if (!t) {
				let r = `Not a YAML token: ${e}`;
				yield* this.pop({ type: 'error', offset: this.offset, message: r, source: e }), this.offset += e.length;
			} else if (t === 'scalar') this.atNewLine = !1, this.atScalar = !0, this.type = 'scalar';
			else {
				switch (this.type = t, yield* this.step(), t) {
					case 'newline':
						if (this.atNewLine = !0, this.indent = 0, this.onNewLine) this.onNewLine(this.offset + e.length);
						break;
					case 'space':
						if (this.atNewLine && e[0] === ' ') this.indent += e.length;
						break;
					case 'explicit-key-ind':
					case 'map-value-ind':
					case 'seq-item-ind':
						if (this.atNewLine) this.indent += e.length;
						break;
					case 'doc-mode':
					case 'flow-error-end':
						return;
					default:
						this.atNewLine = !1;
				}
				this.offset += e.length;
			}
		}
		*end() {
			while (this.stack.length > 0) yield* this.pop();
		}
		get sourceToken() {
			return { type: this.type, offset: this.offset, indent: this.indent, source: this.source };
		}
		*step() {
			let e = this.peek(1);
			if (this.type === 'doc-end' && e?.type !== 'doc-end') {
				while (this.stack.length > 0) yield* this.pop();
				this.stack.push({ type: 'doc-end', offset: this.offset, source: this.source });
				return;
			}
			if (!e) return yield* this.stream();
			switch (e.type) {
				case 'document':
					return yield* this.document(e);
				case 'alias':
				case 'scalar':
				case 'single-quoted-scalar':
				case 'double-quoted-scalar':
					return yield* this.scalar(e);
				case 'block-scalar':
					return yield* this.blockScalar(e);
				case 'block-map':
					return yield* this.blockMap(e);
				case 'block-seq':
					return yield* this.blockSequence(e);
				case 'flow-collection':
					return yield* this.flowCollection(e);
				case 'doc-end':
					return yield* this.documentEnd(e);
			}
			yield* this.pop();
		}
		peek(e) {
			return this.stack[this.stack.length - e];
		}
		*pop(e) {
			let t = e ?? this.stack.pop();
			if (!t) yield { type: 'error', offset: this.offset, source: '', message: 'Tried to pop an empty stack' };
			else if (this.stack.length === 0) yield t;
			else {
				let r = this.peek(1);
				if (t.type === 'block-scalar') t.indent = 'indent' in r ? r.indent : 0;
				else if (t.type === 'flow-collection' && r.type === 'document') t.indent = 0;
				if (t.type === 'flow-collection') rp(t);
				switch (r.type) {
					case 'document':
						r.value = t;
						break;
					case 'block-scalar':
						r.props.push(t);
						break;
					case 'block-map': {
						let n = r.items[r.items.length - 1];
						if (n.value) {
							r.items.push({ start: [], key: t, sep: [] }), this.onKeyLine = !0;
							return;
						} else if (n.sep) n.value = t;
						else {
							Object.assign(n, { key: t, sep: [] }), this.onKeyLine = !n.explicitKey;
							return;
						}
						break;
					}
					case 'block-seq': {
						let n = r.items[r.items.length - 1];
						if (n.value) r.items.push({ start: [], value: t });
						else n.value = t;
						break;
					}
					case 'flow-collection': {
						let n = r.items[r.items.length - 1];
						if (!n || n.value) r.items.push({ start: [], key: t, sep: [] });
						else if (n.sep) n.value = t;
						else Object.assign(n, { key: t, sep: [] });
						return;
					}
					default:
						yield* this.pop(), yield* this.pop(t);
				}
				if (
					(r.type === 'document' || r.type === 'block-map' || r.type === 'block-seq')
					&& (t.type === 'block-map' || t.type === 'block-seq')
				) {
					let n = t.items[t.items.length - 1];
					if (
						n && !n.sep && !n.value && n.start.length > 0 && tp(n.start) === -1
						&& (t.indent === 0 || n.start.every((i) => i.type !== 'comment' || i.indent < t.indent))
					) {
						if (r.type === 'document') r.end = n.start;
						else r.items.push({ start: n.start });
						t.items.splice(-1, 1);
					}
				}
			}
		}
		*stream() {
			switch (this.type) {
				case 'directive-line':
					yield { type: 'directive', offset: this.offset, source: this.source };
					return;
				case 'byte-order-mark':
				case 'space':
				case 'comment':
				case 'newline':
					yield this.sourceToken;
					return;
				case 'doc-mode':
				case 'doc-start': {
					let e = { type: 'document', offset: this.offset, start: [] };
					if (this.type === 'doc-start') e.start.push(this.sourceToken);
					this.stack.push(e);
					return;
				}
			}
			yield {
				type: 'error',
				offset: this.offset,
				message: `Unexpected ${this.type} token in YAML stream`,
				source: this.source,
			};
		}
		*document(e) {
			if (e.value) return yield* this.lineEnd(e);
			switch (this.type) {
				case 'doc-start': {
					if (tp(e.start) !== -1) yield* this.pop(), yield* this.step();
					else e.start.push(this.sourceToken);
					return;
				}
				case 'anchor':
				case 'tag':
				case 'space':
				case 'comment':
				case 'newline':
					e.start.push(this.sourceToken);
					return;
			}
			let t = this.startBlockValue(e);
			if (t) this.stack.push(t);
			else {yield {
					type: 'error',
					offset: this.offset,
					message: `Unexpected ${this.type} token in YAML document`,
					source: this.source,
				};}
		}
		*scalar(e) {
			if (this.type === 'map-value-ind') {
				let t = zi(this.peek(2)), r = br(t), n;
				if (e.end) n = e.end, n.push(this.sourceToken), delete e.end;
				else n = [this.sourceToken];
				let i = { type: 'block-map', offset: e.offset, indent: e.indent, items: [{ start: r, key: e, sep: n }] };
				this.onKeyLine = !0, this.stack[this.stack.length - 1] = i;
			} else yield* this.lineEnd(e);
		}
		*blockScalar(e) {
			switch (this.type) {
				case 'space':
				case 'comment':
				case 'newline':
					e.props.push(this.sourceToken);
					return;
				case 'scalar':
					if (e.source = this.source, this.atNewLine = !0, this.indent = 0, this.onNewLine) {
						let t = this.source.indexOf(`
`) + 1;
						while (t !== 0) {
							this.onNewLine(this.offset + t),
								t = this.source.indexOf(
									`
`,
									t,
								) + 1;
						}
					}
					yield* this.pop();
					break;
				default:
					yield* this.pop(), yield* this.step();
			}
		}
		*blockMap(e) {
			let t = e.items[e.items.length - 1];
			switch (this.type) {
				case 'newline':
					if (this.onKeyLine = !1, t.value) {
						let r = 'end' in t.value ? t.value.end : void 0;
						if ((Array.isArray(r) ? r[r.length - 1] : void 0)?.type === 'comment') r?.push(this.sourceToken);
						else e.items.push({ start: [this.sourceToken] });
					} else if (t.sep) t.sep.push(this.sourceToken);
					else t.start.push(this.sourceToken);
					return;
				case 'space':
				case 'comment':
					if (t.value) e.items.push({ start: [this.sourceToken] });
					else if (t.sep) t.sep.push(this.sourceToken);
					else {
						if (this.atIndentedComment(t.start, e.indent)) {
							let n = e.items[e.items.length - 2]?.value?.end;
							if (Array.isArray(n)) {
								Ti(n, t.start), n.push(this.sourceToken), e.items.pop();
								return;
							}
						}
						t.start.push(this.sourceToken);
					}
					return;
			}
			if (this.indent >= e.indent) {
				let r = !this.onKeyLine && this.indent === e.indent,
					n = r && (t.sep || t.explicitKey) && this.type !== 'seq-item-ind',
					i = [];
				if (n && t.sep && !t.value) {
					let o = [];
					for (let s = 0; s < t.sep.length; ++s) {
						let a = t.sep[s];
						switch (a.type) {
							case 'newline':
								o.push(s);
								break;
							case 'space':
								break;
							case 'comment':
								if (a.indent > e.indent) o.length = 0;
								break;
							default:
								o.length = 0;
						}
					}
					if (o.length >= 2) i = t.sep.splice(o[1]);
				}
				switch (this.type) {
					case 'anchor':
					case 'tag':
						if (n || t.value) i.push(this.sourceToken), e.items.push({ start: i }), this.onKeyLine = !0;
						else if (t.sep) t.sep.push(this.sourceToken);
						else t.start.push(this.sourceToken);
						return;
					case 'explicit-key-ind':
						if (!t.sep && !t.explicitKey) t.start.push(this.sourceToken), t.explicitKey = !0;
						else if (n || t.value) i.push(this.sourceToken), e.items.push({ start: i, explicitKey: !0 });
						else {this.stack.push({
								type: 'block-map',
								offset: this.offset,
								indent: this.indent,
								items: [{ start: [this.sourceToken], explicitKey: !0 }],
							});}
						this.onKeyLine = !0;
						return;
					case 'map-value-ind':
						if (t.explicitKey) {
							if (!t.sep) {
								if (bt(t.start, 'newline')) Object.assign(t, { key: null, sep: [this.sourceToken] });
								else {
									let o = br(t.start);
									this.stack.push({
										type: 'block-map',
										offset: this.offset,
										indent: this.indent,
										items: [{ start: o, key: null, sep: [this.sourceToken] }],
									});
								}
							} else if (t.value) e.items.push({ start: [], key: null, sep: [this.sourceToken] });
							else if (bt(t.sep, 'map-value-ind')) {
								this.stack.push({
									type: 'block-map',
									offset: this.offset,
									indent: this.indent,
									items: [{ start: i, key: null, sep: [this.sourceToken] }],
								});
							} else if (np(t.key) && !bt(t.sep, 'newline')) {
								let o = br(t.start), { key: s, sep: a } = t;
								a.push(this.sourceToken),
									delete t.key,
									delete t.sep,
									this.stack.push({
										type: 'block-map',
										offset: this.offset,
										indent: this.indent,
										items: [{ start: o, key: s, sep: a }],
									});
							} else if (i.length > 0) t.sep = t.sep.concat(i, this.sourceToken);
							else t.sep.push(this.sourceToken);
						} else if (!t.sep) Object.assign(t, { key: null, sep: [this.sourceToken] });
						else if (t.value || n) e.items.push({ start: i, key: null, sep: [this.sourceToken] });
						else if (bt(t.sep, 'map-value-ind')) {
							this.stack.push({
								type: 'block-map',
								offset: this.offset,
								indent: this.indent,
								items: [{ start: [], key: null, sep: [this.sourceToken] }],
							});
						} else t.sep.push(this.sourceToken);
						this.onKeyLine = !0;
						return;
					case 'alias':
					case 'scalar':
					case 'single-quoted-scalar':
					case 'double-quoted-scalar': {
						let o = this.flowScalar(this.type);
						if (n || t.value) e.items.push({ start: i, key: o, sep: [] }), this.onKeyLine = !0;
						else if (t.sep) this.stack.push(o);
						else Object.assign(t, { key: o, sep: [] }), this.onKeyLine = !0;
						return;
					}
					default: {
						let o = this.startBlockValue(e);
						if (o) {
							if (o.type === 'block-seq') {
								if (!t.explicitKey && t.sep && !bt(t.sep, 'newline')) {
									yield* this.pop({
										type: 'error',
										offset: this.offset,
										message: 'Unexpected block-seq-ind on same line with key',
										source: this.source,
									});
									return;
								}
							} else if (r) e.items.push({ start: i });
							this.stack.push(o);
							return;
						}
					}
				}
			}
			yield* this.pop(), yield* this.step();
		}
		*blockSequence(e) {
			let t = e.items[e.items.length - 1];
			switch (this.type) {
				case 'newline':
					if (t.value) {
						let r = 'end' in t.value ? t.value.end : void 0;
						if ((Array.isArray(r) ? r[r.length - 1] : void 0)?.type === 'comment') r?.push(this.sourceToken);
						else e.items.push({ start: [this.sourceToken] });
					} else t.start.push(this.sourceToken);
					return;
				case 'space':
				case 'comment':
					if (t.value) e.items.push({ start: [this.sourceToken] });
					else {
						if (this.atIndentedComment(t.start, e.indent)) {
							let n = e.items[e.items.length - 2]?.value?.end;
							if (Array.isArray(n)) {
								Ti(n, t.start), n.push(this.sourceToken), e.items.pop();
								return;
							}
						}
						t.start.push(this.sourceToken);
					}
					return;
				case 'anchor':
				case 'tag':
					if (t.value || this.indent <= e.indent) break;
					t.start.push(this.sourceToken);
					return;
				case 'seq-item-ind':
					if (this.indent !== e.indent) break;
					if (t.value || bt(t.start, 'seq-item-ind')) e.items.push({ start: [this.sourceToken] });
					else t.start.push(this.sourceToken);
					return;
			}
			if (this.indent > e.indent) {
				let r = this.startBlockValue(e);
				if (r) {
					this.stack.push(r);
					return;
				}
			}
			yield* this.pop(), yield* this.step();
		}
		*flowCollection(e) {
			let t = e.items[e.items.length - 1];
			if (this.type === 'flow-error-end') {
				let r;
				do yield* this.pop(), r = this.peek(1); while (r?.type === 'flow-collection');
			} else if (e.end.length === 0) {
				switch (this.type) {
					case 'comma':
					case 'explicit-key-ind':
						if (!t || t.sep) e.items.push({ start: [this.sourceToken] });
						else t.start.push(this.sourceToken);
						return;
					case 'map-value-ind':
						if (!t || t.value) e.items.push({ start: [], key: null, sep: [this.sourceToken] });
						else if (t.sep) t.sep.push(this.sourceToken);
						else Object.assign(t, { key: null, sep: [this.sourceToken] });
						return;
					case 'space':
					case 'comment':
					case 'newline':
					case 'anchor':
					case 'tag':
						if (!t || t.value) e.items.push({ start: [this.sourceToken] });
						else if (t.sep) t.sep.push(this.sourceToken);
						else t.start.push(this.sourceToken);
						return;
					case 'alias':
					case 'scalar':
					case 'single-quoted-scalar':
					case 'double-quoted-scalar': {
						let n = this.flowScalar(this.type);
						if (!t || t.value) e.items.push({ start: [], key: n, sep: [] });
						else if (t.sep) this.stack.push(n);
						else Object.assign(t, { key: n, sep: [] });
						return;
					}
					case 'flow-map-end':
					case 'flow-seq-end':
						e.end.push(this.sourceToken);
						return;
				}
				let r = this.startBlockValue(e);
				if (r) this.stack.push(r);
				else yield* this.pop(), yield* this.step();
			} else {
				let r = this.peek(2);
				if (
					r.type === 'block-map'
					&& (this.type === 'map-value-ind' && r.indent === e.indent
						|| this.type === 'newline' && !r.items[r.items.length - 1].sep)
				) yield* this.pop(), yield* this.step();
				else if (this.type === 'map-value-ind' && r.type !== 'flow-collection') {
					let n = zi(r), i = br(n);
					rp(e);
					let o = e.end.splice(1, e.end.length);
					o.push(this.sourceToken);
					let s = { type: 'block-map', offset: e.offset, indent: e.indent, items: [{ start: i, key: e, sep: o }] };
					this.onKeyLine = !0, this.stack[this.stack.length - 1] = s;
				} else yield* this.lineEnd(e);
			}
		}
		flowScalar(e) {
			if (this.onNewLine) {
				let t = this.source.indexOf(`
`) + 1;
				while (t !== 0) {
					this.onNewLine(this.offset + t),
						t = this.source.indexOf(
							`
`,
							t,
						) + 1;
				}
			}
			return { type: e, offset: this.offset, indent: this.indent, source: this.source };
		}
		startBlockValue(e) {
			switch (this.type) {
				case 'alias':
				case 'scalar':
				case 'single-quoted-scalar':
				case 'double-quoted-scalar':
					return this.flowScalar(this.type);
				case 'block-scalar-header':
					return {
						type: 'block-scalar',
						offset: this.offset,
						indent: this.indent,
						props: [this.sourceToken],
						source: '',
					};
				case 'flow-map-start':
				case 'flow-seq-start':
					return {
						type: 'flow-collection',
						offset: this.offset,
						indent: this.indent,
						start: this.sourceToken,
						items: [],
						end: [],
					};
				case 'seq-item-ind':
					return {
						type: 'block-seq',
						offset: this.offset,
						indent: this.indent,
						items: [{ start: [this.sourceToken] }],
					};
				case 'explicit-key-ind': {
					this.onKeyLine = !0;
					let t = zi(e), r = br(t);
					return r.push(this.sourceToken),
						{ type: 'block-map', offset: this.offset, indent: this.indent, items: [{ start: r, explicitKey: !0 }] };
				}
				case 'map-value-ind': {
					this.onKeyLine = !0;
					let t = zi(e), r = br(t);
					return {
						type: 'block-map',
						offset: this.offset,
						indent: this.indent,
						items: [{ start: r, key: null, sep: [this.sourceToken] }],
					};
				}
			}
			return null;
		}
		atIndentedComment(e, t) {
			if (this.type !== 'comment') return !1;
			if (this.indent <= t) return !1;
			return e.every((r) => r.type === 'newline' || r.type === 'space');
		}
		*documentEnd(e) {
			if (this.type !== 'doc-mode') {
				if (e.end) e.end.push(this.sourceToken);
				else e.end = [this.sourceToken];
				if (this.type === 'newline') yield* this.pop();
			}
		}
		*lineEnd(e) {
			switch (this.type) {
				case 'comma':
				case 'doc-start':
				case 'doc-end':
				case 'flow-seq-end':
				case 'flow-map-end':
				case 'map-value-ind':
					yield* this.pop(), yield* this.step();
					break;
				case 'newline':
					this.onKeyLine = !1;
				case 'space':
				case 'comment':
				default:
					if (e.end) e.end.push(this.sourceToken);
					else e.end = [this.sourceToken];
					if (this.type === 'newline') yield* this.pop();
			}
		}
	}
	X1.Parser = ip;
});
var up = D(function(cC) {
	var op = Gs(), tC = Xr(), sn = en(), rC = os(), nC = W(), iC = oa(), sp = sa();
	function ap(e) {
		let t = e.prettyErrors !== !1;
		return { lineCounter: e.lineCounter || t && new iC.LineCounter() || null, prettyErrors: t };
	}
	function oC(e, t = {}) {
		let { lineCounter: r, prettyErrors: n } = ap(t),
			i = new sp.Parser(r?.addNewLine),
			o = new op.Composer(t),
			s = Array.from(o.compose(i.parse(e)));
		if (n && r) {
			for (let a of s) a.errors.forEach(sn.prettifyError(e, r)), a.warnings.forEach(sn.prettifyError(e, r));
		}
		if (s.length > 0) return s;
		return Object.assign([], { empty: !0 }, o.streamInfo());
	}
	function cp(e, t = {}) {
		let { lineCounter: r, prettyErrors: n } = ap(t), i = new sp.Parser(r?.addNewLine), o = new op.Composer(t), s = null;
		for (let a of o.compose(i.parse(e), !0, e.length)) {
			if (!s) s = a;
			else if (s.options.logLevel !== 'silent') {
				s.errors.push(
					new sn.YAMLParseError(
						a.range.slice(0, 2),
						'MULTIPLE_DOCS',
						'Source contains multiple documents; please use YAML.parseAllDocuments()',
					),
				);
				break;
			}
		}
		if (n && r) s.errors.forEach(sn.prettifyError(e, r)), s.warnings.forEach(sn.prettifyError(e, r));
		return s;
	}
	function sC(e, t, r) {
		let n = void 0;
		if (typeof t === 'function') n = t;
		else if (r === void 0 && t && typeof t === 'object') r = t;
		let i = cp(e, r);
		if (!i) return null;
		if (i.warnings.forEach((o) => rC.warn(i.options.logLevel, o)), i.errors.length > 0) {
			if (i.options.logLevel !== 'silent') {
				throw i.errors[0];
			} else i.errors = [];
		}
		return i.toJS(Object.assign({ reviver: n }, r));
	}
	function aC(e, t, r) {
		let n = null;
		if (typeof t === 'function' || Array.isArray(t)) n = t;
		else if (r === void 0 && t) r = t;
		if (typeof r === 'string') r = r.length;
		if (typeof r === 'number') {
			let i = Math.round(r);
			r = i < 1 ? void 0 : i > 8 ? { indent: 8 } : { indent: i };
		}
		if (e === void 0) {
			let { keepUndefined: i } = r ?? t ?? {};
			if (!i) return;
		}
		if (nC.isDocument(e) && !n) return e.toString(r);
		return new tC.Document(e, n, r).toString(r);
	}
	cC.parse = sC;
	cC.parseAllDocuments = oC;
	cC.parseDocument = cp;
	cC.stringify = aC;
});
var jg = D(function(WR, Zg) {
	var _r = 1000, Cr = _r * 60, zr = Cr * 60, Wt = zr * 24, xE = Wt * 7, kE = Wt * 365.25;
	Zg.exports = function(e, t) {
		t = t || {};
		var r = typeof e;
		if (r === 'string' && e.length > 0) return wE(e);
		else if (r === 'number' && isFinite(e)) return t.long ? vE(e) : SE(e);
		throw Error('val is not a non-empty string or a valid number. val=' + JSON.stringify(e));
	};
	function wE(e) {
		if (e = String(e), e.length > 100) return;
		var t =
			/^(-?(?:\d+)?\.?\d+) *(milliseconds?|msecs?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w|years?|yrs?|y)?$/i
				.exec(e);
		if (!t) return;
		var r = parseFloat(t[1]), n = (t[2] || 'ms').toLowerCase();
		switch (n) {
			case 'years':
			case 'year':
			case 'yrs':
			case 'yr':
			case 'y':
				return r * kE;
			case 'weeks':
			case 'week':
			case 'w':
				return r * xE;
			case 'days':
			case 'day':
			case 'd':
				return r * Wt;
			case 'hours':
			case 'hour':
			case 'hrs':
			case 'hr':
			case 'h':
				return r * zr;
			case 'minutes':
			case 'minute':
			case 'mins':
			case 'min':
			case 'm':
				return r * Cr;
			case 'seconds':
			case 'second':
			case 'secs':
			case 'sec':
			case 's':
				return r * _r;
			case 'milliseconds':
			case 'millisecond':
			case 'msecs':
			case 'msec':
			case 'ms':
				return r;
			default:
				return;
		}
	}
	function SE(e) {
		var t = Math.abs(e);
		if (t >= Wt) return Math.round(e / Wt) + 'd';
		if (t >= zr) return Math.round(e / zr) + 'h';
		if (t >= Cr) return Math.round(e / Cr) + 'm';
		if (t >= _r) return Math.round(e / _r) + 's';
		return e + 'ms';
	}
	function vE(e) {
		var t = Math.abs(e);
		if (t >= Wt) return vo(e, t, Wt, 'day');
		if (t >= zr) return vo(e, t, zr, 'hour');
		if (t >= Cr) return vo(e, t, Cr, 'minute');
		if (t >= _r) return vo(e, t, _r, 'second');
		return e + ' ms';
	}
	function vo(e, t, r, n) {
		var i = t >= r * 1.5;
		return Math.round(e / r) + ' ' + n + (i ? 's' : '');
	}
});
var kc = D(function(YR, Ug) {
	function _E(e) {
		r.debug = r,
			r.default = r,
			r.coerce = c,
			r.disable = s,
			r.enable = i,
			r.enabled = a,
			r.humanize = jg(),
			r.destroy = u,
			Object.keys(e).forEach((l) => {
				r[l] = e[l];
			}),
			r.names = [],
			r.skips = [],
			r.formatters = {};
		function t(l) {
			let f = 0;
			for (let h = 0; h < l.length; h++) f = (f << 5) - f + l.charCodeAt(h), f |= 0;
			return r.colors[Math.abs(f) % r.colors.length];
		}
		r.selectColor = t;
		function r(l) {
			let f, h = null, d, g;
			function y(...x) {
				if (!y.enabled) return;
				let k = y, z = Number(new Date()), _ = z - (f || z);
				if (k.diff = _, k.prev = f, k.curr = z, f = z, x[0] = r.coerce(x[0]), typeof x[0] !== 'string') x.unshift('%O');
				let O = 0;
				x[0] = x[0].replace(/%([a-zA-Z%])/g, (v, q) => {
					if (v === '%%') return '%';
					O++;
					let L = r.formatters[q];
					if (typeof L === 'function') {
						let U = x[O];
						v = L.call(k, U), x.splice(O, 1), O--;
					}
					return v;
				}),
					r.formatArgs.call(k, x),
					(k.log || r.log).apply(k, x);
			}
			if (
				y.namespace = l,
					y.useColors = r.useColors(),
					y.color = r.selectColor(l),
					y.extend = n,
					y.destroy = r.destroy,
					Object.defineProperty(y, 'enabled', {
						enumerable: !0,
						configurable: !1,
						get: () => {
							if (h !== null) return h;
							if (d !== r.namespaces) d = r.namespaces, g = r.enabled(l);
							return g;
						},
						set: (x) => {
							h = x;
						},
					}),
					typeof r.init === 'function'
			) r.init(y);
			return y;
		}
		function n(l, f) {
			let h = r(this.namespace + (typeof f > 'u' ? ':' : f) + l);
			return h.log = this.log, h;
		}
		function i(l) {
			r.save(l), r.namespaces = l, r.names = [], r.skips = [];
			let f = (typeof l === 'string' ? l : '').trim().replace(/\s+/g, ',').split(',').filter(Boolean);
			for (let h of f) {
				if (h[0] === '-') r.skips.push(h.slice(1));
				else r.names.push(h);
			}
		}
		function o(l, f) {
			let h = 0, d = 0, g = -1, y = 0;
			while (h < l.length) {
				if (d < f.length && (f[d] === l[h] || f[d] === '*')) {
					if (f[d] === '*') g = d, y = h, d++;
					else h++, d++;
				} else if (g !== -1) d = g + 1, y++, h = y;
				else return !1;
			}
			while (d < f.length && f[d] === '*') d++;
			return d === f.length;
		}
		function s() {
			let l = [...r.names, ...r.skips.map((f) => '-' + f)].join(',');
			return r.enable(''), l;
		}
		function a(l) {
			for (let f of r.skips) if (o(l, f)) return !1;
			for (let f of r.names) if (o(l, f)) return !0;
			return !1;
		}
		function c(l) {
			if (l instanceof Error) return l.stack || l.message;
			return l;
		}
		function u() {
			console.warn(
				'Instance method `debug.destroy()` is deprecated and no longer does anything. It will be removed in the next major version of `debug`.',
			);
		}
		return r.enable(r.load()), r;
	}
	Ug.exports = _E;
});
var Vg = D(function(wc, _o) {
	wc.formatArgs = zE;
	wc.save = TE;
	wc.load = AE;
	wc.useColors = CE;
	wc.storage = EE();
	wc.destroy = (() => {
		let e = !1;
		return () => {
			if (!e) {
				e = !0,
					console.warn(
						'Instance method `debug.destroy()` is deprecated and no longer does anything. It will be removed in the next major version of `debug`.',
					);
			}
		};
	})();
	wc.colors = [
		'#0000CC',
		'#0000FF',
		'#0033CC',
		'#0033FF',
		'#0066CC',
		'#0066FF',
		'#0099CC',
		'#0099FF',
		'#00CC00',
		'#00CC33',
		'#00CC66',
		'#00CC99',
		'#00CCCC',
		'#00CCFF',
		'#3300CC',
		'#3300FF',
		'#3333CC',
		'#3333FF',
		'#3366CC',
		'#3366FF',
		'#3399CC',
		'#3399FF',
		'#33CC00',
		'#33CC33',
		'#33CC66',
		'#33CC99',
		'#33CCCC',
		'#33CCFF',
		'#6600CC',
		'#6600FF',
		'#6633CC',
		'#6633FF',
		'#66CC00',
		'#66CC33',
		'#9900CC',
		'#9900FF',
		'#9933CC',
		'#9933FF',
		'#99CC00',
		'#99CC33',
		'#CC0000',
		'#CC0033',
		'#CC0066',
		'#CC0099',
		'#CC00CC',
		'#CC00FF',
		'#CC3300',
		'#CC3333',
		'#CC3366',
		'#CC3399',
		'#CC33CC',
		'#CC33FF',
		'#CC6600',
		'#CC6633',
		'#CC9900',
		'#CC9933',
		'#CCCC00',
		'#CCCC33',
		'#FF0000',
		'#FF0033',
		'#FF0066',
		'#FF0099',
		'#FF00CC',
		'#FF00FF',
		'#FF3300',
		'#FF3333',
		'#FF3366',
		'#FF3399',
		'#FF33CC',
		'#FF33FF',
		'#FF6600',
		'#FF6633',
		'#FF9900',
		'#FF9933',
		'#FFCC00',
		'#FFCC33',
	];
	function CE() {
		if (typeof window < 'u' && window.process && (window.process.type === 'renderer' || window.process.__nwjs)) {
			return !0;
		}
		if (
			typeof navigator < 'u' && navigator.userAgent && navigator.userAgent.toLowerCase().match(/(edge|trident)\/(\d+)/)
		) return !1;
		let e;
		return typeof document < 'u' && document.documentElement && document.documentElement.style
				&& document.documentElement.style.WebkitAppearance
			|| typeof window < 'u' && window.console
				&& (window.console.firebug || window.console.exception && window.console.table)
			|| typeof navigator < 'u' && navigator.userAgent
				&& (e = navigator.userAgent.toLowerCase().match(/firefox\/(\d+)/)) && parseInt(e[1], 10) >= 31
			|| typeof navigator < 'u' && navigator.userAgent && navigator.userAgent.toLowerCase().match(/applewebkit\/(\d+)/);
	}
	function zE(e) {
		if (
			e[0] = (this.useColors ? '%c' : '') + this.namespace + (this.useColors ? ' %c' : ' ') + e[0]
				+ (this.useColors ? '%c ' : ' ') + '+' + _o.exports.humanize(this.diff), !this.useColors
		) return;
		let t = 'color: ' + this.color;
		e.splice(1, 0, t, 'color: inherit');
		let r = 0, n = 0;
		e[0].replace(/%[a-zA-Z%]/g, (i) => {
			if (i === '%%') return;
			if (r++, i === '%c') n = r;
		}), e.splice(n, 0, t);
	}
	wc.log = console.debug || console.log || (() => {});
	function TE(e) {
		try {
			if (e) wc.storage.setItem('debug', e);
			else wc.storage.removeItem('debug');
		} catch (t) {}
	}
	function AE() {
		let e;
		try {
			e = wc.storage.getItem('debug') || wc.storage.getItem('DEBUG');
		} catch (t) {}
		if (!e && typeof process < 'u' && 'env' in process) e = process.env.DEBUG;
		return e;
	}
	function EE() {
		try {
			return localStorage;
		} catch (e) {}
	}
	_o.exports = kc()(wc);
	var { formatters: IE } = _o.exports;
	IE.j = function(e) {
		try {
			return JSON.stringify(e);
		} catch (t) {
			return '[UnexpectedJSONParseError]: ' + t.message;
		}
	};
});
var Jg = {};
el(Jg, { createSupportsColor: () => Sc, default: () => jE });
import vc from 'node:process';
import ME from 'node:os';
import Kg from 'node:tty';
function qe(e, t = globalThis.Deno ? globalThis.Deno.args : vc.argv) {
	let r = e.startsWith('-') ? '' : e.length === 1 ? '-' : '--', n = t.indexOf(r + e), i = t.indexOf('--');
	return n !== -1 && (i === -1 || n < i);
}
function FE() {
	if (!('FORCE_COLOR' in te)) return;
	if (te.FORCE_COLOR === 'true') return 1;
	if (te.FORCE_COLOR === 'false') return 0;
	if (te.FORCE_COLOR.length === 0) return 1;
	let e = Math.min(Number.parseInt(te.FORCE_COLOR, 10), 3);
	if (![0, 1, 2, 3].includes(e)) return;
	return e;
}
function RE(e) {
	if (e === 0) return !1;
	return { level: e, hasBasic: !0, has256: e >= 2, has16m: e >= 3 };
}
function BE(e, { streamIsTTY: t, sniffFlags: r = !0 } = {}) {
	let n = FE();
	if (n !== void 0) Co = n;
	let i = r ? Co : n;
	if (i === 0) return 0;
	if (r) {
		if (qe('color=16m') || qe('color=full') || qe('color=truecolor')) return 3;
		if (qe('color=256')) return 2;
	}
	if ('TF_BUILD' in te && 'AGENT_NAME' in te) return 1;
	if (e && !t && i === void 0) return 0;
	let o = i || 0;
	if (te.TERM === 'dumb') return o;
	if (vc.platform === 'win32') {
		let s = ME.release().split('.');
		if (Number(s[0]) >= 10 && Number(s[2]) >= 10586) return Number(s[2]) >= 14931 ? 3 : 2;
		return 1;
	}
	if ('CI' in te) {
		if (['GITHUB_ACTIONS', 'GITEA_ACTIONS', 'CIRCLECI'].some((s) => (s in te))) return 3;
		if (['TRAVIS', 'APPVEYOR', 'GITLAB_CI', 'BUILDKITE', 'DRONE'].some((s) => (s in te)) || te.CI_NAME === 'codeship') {
			return 1;
		}
		return o;
	}
	if ('TEAMCITY_VERSION' in te) return /^(9\.(0*[1-9]\d*)\.|\d{2,}\.)/.test(te.TEAMCITY_VERSION) ? 1 : 0;
	if (te.COLORTERM === 'truecolor') return 3;
	if (te.TERM === 'xterm-kitty') return 3;
	if (te.TERM === 'xterm-ghostty') return 3;
	if (te.TERM === 'wezterm') return 3;
	if ('TERM_PROGRAM' in te) {
		let s = Number.parseInt((te.TERM_PROGRAM_VERSION || '').split('.')[0], 10);
		switch (te.TERM_PROGRAM) {
			case 'iTerm.app':
				return s >= 3 ? 3 : 2;
			case 'Apple_Terminal':
				return 2;
		}
	}
	if (/-256(color)?$/i.test(te.TERM)) return 2;
	if (/^screen|^xterm|^vt100|^vt220|^rxvt|color|ansi|cygwin|linux/i.test(te.TERM)) return 1;
	if ('COLORTERM' in te) return 1;
	return o;
}
function Sc(e, t = {}) {
	let r = BE(e, { streamIsTTY: e && e.isTTY, ...t });
	return RE(r);
}
var te, Co, ZE, jE;
var Hg = ex(() => {
	({ env: te } = vc);
	if (qe('no-color') || qe('no-colors') || qe('color=false') || qe('color=never')) Co = 0;
	else if (qe('color') || qe('colors') || qe('color=true') || qe('color=always')) Co = 1;
	ZE = { stdout: Sc({ isTTY: Kg.isatty(1) }), stderr: Sc({ isTTY: Kg.isatty(2) }) }, jE = ZE;
});
var Qg = D(function(_c, zo) {
	var Gg = ar('tty'), Tt = ar('util');
	_c.init = WE;
	_c.log = JE;
	_c.formatArgs = VE;
	_c.save = HE;
	_c.load = GE;
	_c.useColors = UE;
	_c.destroy = Tt.deprecate(
		() => {},
		'Instance method `debug.destroy()` is deprecated and no longer does anything. It will be removed in the next major version of `debug`.',
	);
	_c.colors = [6, 2, 3, 4, 5, 1];
	try {
		let e = (Hg(), Yb(Jg));
		if (e && (e.stderr || e).level >= 2) {
			_c.colors = [
				20,
				21,
				26,
				27,
				32,
				33,
				38,
				39,
				40,
				41,
				42,
				43,
				44,
				45,
				56,
				57,
				62,
				63,
				68,
				69,
				74,
				75,
				76,
				77,
				78,
				79,
				80,
				81,
				92,
				93,
				98,
				99,
				112,
				113,
				128,
				129,
				134,
				135,
				148,
				149,
				160,
				161,
				162,
				163,
				164,
				165,
				166,
				167,
				168,
				169,
				170,
				171,
				172,
				173,
				178,
				179,
				184,
				185,
				196,
				197,
				198,
				199,
				200,
				201,
				202,
				203,
				204,
				205,
				206,
				207,
				208,
				209,
				214,
				215,
				220,
				221,
			];
		}
	} catch (e) {}
	_c.inspectOpts = Object.keys(process.env).filter((e) => /^debug_/i.test(e)).reduce((e, t) => {
		let r = t.substring(6).toLowerCase().replace(/_([a-z])/g, (i, o) => o.toUpperCase()), n = process.env[t];
		if (/^(yes|on|true|enabled)$/i.test(n)) n = !0;
		else if (/^(no|off|false|disabled)$/i.test(n)) n = !1;
		else if (n === 'null') n = null;
		else n = Number(n);
		return e[r] = n, e;
	}, {});
	function UE() {
		return 'colors' in _c.inspectOpts ? Boolean(_c.inspectOpts.colors) : Gg.isatty(process.stderr.fd);
	}
	function VE(e) {
		let { namespace: t, useColors: r } = this;
		if (r) {
			let n = this.color, i = '\x1B[3' + (n < 8 ? n : '8;5;' + n), o = `  ${i};1m${t} \x1B[0m`;
			e[0] = o + e[0].split(`
`).join(
				`
` + o,
			), e.push(i + 'm+' + zo.exports.humanize(this.diff) + '\x1B[0m');
		} else e[0] = KE() + t + ' ' + e[0];
	}
	function KE() {
		if (_c.inspectOpts.hideDate) return '';
		return new Date().toISOString() + ' ';
	}
	function JE(...e) {
		return process.stderr.write(
			Tt.formatWithOptions(_c.inspectOpts, ...e) + `
`,
		);
	}
	function HE(e) {
		if (e) process.env.DEBUG = e;
		else delete process.env.DEBUG;
	}
	function GE() {
		return process.env.DEBUG;
	}
	function WE(e) {
		e.inspectOpts = {};
		let t = Object.keys(_c.inspectOpts);
		for (let r = 0; r < t.length; r++) e.inspectOpts[t[r]] = _c.inspectOpts[t[r]];
	}
	zo.exports = kc()(_c);
	var { formatters: Wg } = zo.exports;
	Wg.o = function(e) {
		return this.inspectOpts.colors = this.useColors,
			Tt.inspect(e, this.inspectOpts).split(`
`).map((t) => t.trim()).join(' ');
	};
	Wg.O = function(e) {
		return this.inspectOpts.colors = this.useColors, Tt.inspect(e, this.inspectOpts);
	};
});
var Xg = D(function(nB, Cc) {
	if (typeof process > 'u' || process.type === 'renderer' || !1 || process.__nwjs) Cc.exports = Vg();
	else Cc.exports = Qg();
});
var Xy = D(function(Dj, Qy) {
	var Fo = Object.prototype.hasOwnProperty,
		Yy = Object.prototype.toString,
		{ defineProperty: Vy, getOwnPropertyDescriptor: Ky } = Object,
		Jy = function(t) {
			if (typeof Array.isArray === 'function') return Array.isArray(t);
			return Yy.call(t) === '[object Array]';
		},
		Hy = function(t) {
			if (!t || Yy.call(t) !== '[object Object]') return !1;
			var r = Fo.call(t, 'constructor'),
				n = t.constructor && t.constructor.prototype && Fo.call(t.constructor.prototype, 'isPrototypeOf');
			if (t.constructor && !r && !n) return !1;
			var i;
			for (i in t);
			return typeof i > 'u' || Fo.call(t, i);
		},
		Gy = function(t, r) {
			if (Vy && r.name === '__proto__') {
				Vy(t, r.name, { enumerable: !0, configurable: !0, value: r.newValue, writable: !0 });
			} else t[r.name] = r.newValue;
		},
		Wy = function(t, r) {
			if (r === '__proto__') {
				if (!Fo.call(t, r)) return;
				else if (Ky) return Ky(t, r).value;
			}
			return t[r];
		};
	Qy.exports = function e() {
		var t, r, n, i, o, s, a = arguments[0], c = 1, u = arguments.length, l = !1;
		if (typeof a === 'boolean') l = a, a = arguments[1] || {}, c = 2;
		if (a == null || typeof a !== 'object' && typeof a !== 'function') a = {};
		for (; c < u; ++c) {
			if (t = arguments[c], t != null) {
				for (r in t) {
					if (n = Wy(a, r), i = Wy(t, r), a !== i) {
						if (l && i && (Hy(i) || (o = Jy(i)))) {
							if (o) o = !1, s = n && Jy(n) ? n : [];
							else s = n && Hy(n) ? n : {};
							Gy(a, { name: r, newValue: e(l, s, i) });
						} else if (typeof i < 'u') Gy(a, { name: r, newValue: i });
					}
				}
			}
		}
		return a;
	};
});
var xc = {};
el(xc, {
	attentionMarkers: () => yE,
	contentInitial: () => fE,
	disable: () => bE,
	document: () => lE,
	flow: () => hE,
	flowInitial: () => pE,
	insideSpan: () => gE,
	string: () => dE,
	text: () => mE,
});
import { appendFile as xO, mkdir as kO, readFile as Zu, writeFile as wO } from 'node:fs/promises';
import { join as SO, resolve as vO } from 'node:path';
import { parseArgs as _O } from 'node:util';
var hC = Gs(),
	dC = Xr(),
	mC = $s(),
	aa = en(),
	gC = Fr(),
	xt = W(),
	yC = dt(),
	bC = ce(),
	xC = gt(),
	kC = yt(),
	K$ = _i(),
	wC = ia(),
	SC = oa(),
	vC = sa(),
	Ai = up(),
	lp = Dr();
var _C = hC.Composer,
	CC = dC.Document,
	zC = mC.Schema,
	{ YAMLError: TC, YAMLParseError: AC, YAMLWarning: EC } = aa,
	IC = gC.Alias,
	{ isAlias: PC, isCollection: OC, isDocument: $C, isMap: LC, isNode: NC, isPair: qC, isScalar: DC, isSeq: MC } = xt,
	FC = yC.Pair,
	RC = bC.Scalar,
	BC = xC.YAMLMap,
	ZC = kC.YAMLSeq;
var jC = wC.Lexer,
	UC = SC.LineCounter,
	VC = vC.Parser,
	{ parse: KC, parseAllDocuments: JC, parseDocument: HC, stringify: ca } = Ai,
	{ visit: GC, visitAsync: WC } = lp;
function un(e) {
	let t = Object.values(e).filter((n) => typeof n === 'number');
	return Object.entries(e).filter(([n, i]) => t.indexOf(+n) === -1).map(([n, i]) => i);
}
function la(e, t = '|') {
	return e.map((r) => ha(r)).join(t);
}
function ln(e, t) {
	if (typeof t === 'bigint') return t.toString();
	return t;
}
class fp {
	constructor(e) {
		this._getter = e, this._value = void 0;
	}
	get value() {
		let e = this._getter;
		if (e !== void 0) this._value = e(), this._getter = void 0;
		return this._value;
	}
}
function Ei(e) {
	return new fp(e);
}
function pp(e) {
	return e === null || e === void 0;
}
function Ii(e) {
	let t = e.startsWith('^') ? 1 : 0, r = e.endsWith('$') ? e.length - 1 : e.length;
	return e.slice(t, r);
}
function hp(e, t) {
	let r = e / t, n = Math.round(r), i = 4 * Number.EPSILON * Math.max(Math.abs(r), 1);
	if (Math.abs(r - n) < i) return 0;
	return r - n;
}
function He(e, t, r) {
	Object.defineProperty(e, t, { value: r, writable: !0, enumerable: !0, configurable: !0 });
}
function Pi(e) {
	let t = Object.getOwnPropertyDescriptor(e, 'shape');
	return t?.get ? t.get.raw : t?.value;
}
function st(e) {
	return Pi(e._zod.def) ?? e._zod.def.shape;
}
function dp(e, t, r) {
	Object.defineProperty(e, t, {
		get() {
			let n = r();
			return He(this, t, n), n;
		},
		enumerable: !0,
		configurable: !0,
	});
}
function mp(e, t, r) {
	if (t in e) He(e, t, r);
	else e[t] = r;
}
function Bt(e, t, r, n) {
	let i = st(t);
	for (let o of r) {
		let s = Object.getOwnPropertyDescriptor(i, o);
		if (!s.enumerable) continue;
		if (s.get) {
			dp(e, o, () => {
				let a = t._zod.def.shape[o];
				return n ? n(a, o) : a;
			});
		} else mp(e, o, n ? n(s.value, o) : s.value);
	}
}
function YC(e, t) {
	for (let r of Reflect.ownKeys(t)) {
		let n = Object.getOwnPropertyDescriptor(t, r);
		if (!n.enumerable) continue;
		if (n.get) dp(e, r, () => t[r]);
		else mp(e, r, n.value);
	}
}
function ze(...e) {
	let t = {};
	for (let r of e) {
		let n = Object.getOwnPropertyDescriptors(r);
		Object.assign(t, n);
	}
	return Object.defineProperties({}, t);
}
function gp(e) {
	return JSON.stringify(e);
}
function yp(e) {
	return e.toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/[\s_-]+/g, '-').replace(/^-+|-+$/g, '');
}
var fa = 'captureStackTrace' in Error ? Error.captureStackTrace : (...e) => {};
function cn(e) {
	return typeof e === 'object' && e !== null && !Array.isArray(e);
}
var bp = Ei(() => {
	if (Te.jitless) return !1;
	if (typeof navigator < 'u' && navigator?.userAgent?.includes('Cloudflare')) return !1;
	try {
		return new Function(''), !0;
	} catch (e) {
		return !1;
	}
});
function xr(e) {
	if (cn(e) === !1) return !1;
	let t = e.constructor;
	if (t === void 0) return !0;
	if (typeof t !== 'function') return !0;
	let r = t.prototype;
	if (cn(r) === !1) return !1;
	if (Object.prototype.hasOwnProperty.call(r, 'isPrototypeOf') === !1) return !1;
	return !0;
}
function pa(e) {
	if (xr(e)) return { ...e };
	if (Array.isArray(e)) return [...e];
	if (e instanceof Map) return new Map(e);
	if (e instanceof Set) return new Set(e);
	return e;
}
var xp = new Set(['string', 'number', 'symbol']);
function wt(e) {
	return e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function Ge(e, t, r) {
	let n = new e._zod.constr(t ?? e._zod.def);
	if (!t || r?.parent) n._zod.parent = e;
	return n;
}
function B(e) {
	let t = e;
	if (!t) return {};
	if (typeof t === 'string') return { error: () => t };
	if (t?.message !== void 0) {
		if (t?.error !== void 0) throw Error('Cannot specify both `message` and `error` params');
		t.error = t.message;
	}
	if (delete t.message, typeof t.error === 'string') return { ...t, error: () => t.error };
	return t;
}
function ha(e) {
	if (typeof e === 'bigint') return e.toString() + 'n';
	if (typeof e === 'string') return `"${e}"`;
	return `${e}`;
}
function kp(e) {
	return Object.keys(e).filter((t) => e[t]._zod.optin !== void 0 && e[t]._zod.optout === 'optional');
}
var Oi = (() => ({
		safeint: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
		int32: [-2147483648, 2147483647],
		uint32: [0, 4294967295],
		float32: [-340282346638528860000000000000000000000, 340282346638528860000000000000000000000],
		float64: [-Number.MAX_VALUE, Number.MAX_VALUE],
	}))(),
	da = {
		int64: [BigInt('-9223372036854775808'), BigInt('9223372036854775807')],
		uint64: [BigInt(0), BigInt('18446744073709551615')],
	};
function QC(e, t) {
	let r = e._zod.def, n = r.checks;
	if (n && n.length > 0) throw Error('.pick() cannot be used on object schemas containing refinements');
	let o = {};
	return Bt(o, e, $i(e, t)), Ge(e, ze(r, { shape: o, checks: [] }));
}
function $i(e, t) {
	let r = st(e), n = [];
	for (let i of Reflect.ownKeys(t)) {
		if (!Object.getOwnPropertyDescriptor(r, i)?.enumerable) throw Error(`Unrecognized key: "${String(i)}"`);
		if (t[i]) n.push(i);
	}
	return n;
}
function XC(e, t) {
	let r = e._zod.def, n = r.checks;
	if (n && n.length > 0) throw Error('.omit() cannot be used on object schemas containing refinements');
	let o = new Set($i(e, t)), s = {};
	return Bt(s, e, Reflect.ownKeys(st(e)).filter((a) => !o.has(a))), Ge(e, ze(r, { shape: s, checks: [] }));
}
function ez(e, t) {
	if (!xr(t)) throw Error('Invalid input to extend: expected a plain object');
	let r = e._zod.def.checks;
	if (r && r.length > 0) {
		let i = st(e);
		for (let o of Reflect.ownKeys(t)) {
			if (Object.getOwnPropertyDescriptor(i, o) !== void 0) {
				throw Error('Cannot overwrite keys on object schemas containing refinements. Use `.safeExtend()` instead.');
			}
		}
	}
	return Ge(e, ze(e._zod.def, { shape: wp(e, t) }));
}
function wp(e, t) {
	let r = {};
	return Bt(r, e, Reflect.ownKeys(st(e))), YC(r, t), r;
}
function tz(e, t) {
	if (!xr(t)) throw Error('Invalid input to safeExtend: expected a plain object');
	return Ge(e, ze(e._zod.def, { shape: wp(e, t) }));
}
function rz(e, t) {
	if (!t?._zod?.def) {
		throw Error('Invalid input to merge: expected an object schema. To merge a plain shape, use `.extend()`.');
	}
	if (e._zod.def.checks?.length) {
		throw Error('.merge() cannot be used on object schemas containing refinements. Use .safeExtend() instead.');
	}
	let r = {};
	Bt(r, e, Reflect.ownKeys(st(e))), Bt(r, t, Reflect.ownKeys(st(t)));
	let n = ze(e._zod.def, {
		shape: r,
		get catchall() {
			return t._zod.def.catchall;
		},
		checks: t._zod.def.checks ?? [],
	});
	return Ge(e, n);
}
function Sp(e, t, r, n = 'partial') {
	let o = t._zod.def.checks;
	if (o && o.length > 0) throw Error(`.${n}() cannot be used on object schemas containing refinements`);
	let a = r ? new Set($i(t, r)) : void 0, c = {};
	return Bt(
		c,
		t,
		Reflect.ownKeys(st(t)),
		e && ((u, l) => a && !a.has(l) ? u : new e({ type: 'optional', innerType: u })),
	),
		Ge(t, ze(t._zod.def, { shape: c, checks: [] }));
}
function nz(e, t, r) {
	let n = r ? new Set($i(t, r)) : void 0, i = {};
	return Bt(i, t, Reflect.ownKeys(st(t)), (o, s) => n && !n.has(s) ? o : new e({ type: 'nonoptional', innerType: o })),
		Ge(t, ze(t._zod.def, { shape: i }));
}
function We(e, t = 0) {
	if (e.aborted === !0) return !0;
	for (let r = t; r < e.issues.length; r++) if (e.issues[r]?.continue !== !0) return !0;
	return !1;
}
function vp(e, t = 0) {
	if (e.aborted === !0) return !0;
	for (let r = t; r < e.issues.length; r++) if (e.issues[r]?.continue === !1) return !0;
	return !1;
}
function Li(e, t) {
	return t.map((r) => {
		var n;
		return (n = r).path ?? (n.path = []), r.path.unshift(e), r;
	});
}
function an(e) {
	return typeof e === 'string' ? e : e?.message;
}
function ma(e) {
	let t = [];
	for (let r of e ?? []) {
		let n = r._zod.def;
		if (!/_(length|size)$|_equals$/.test(n.check)) break;
		let i = n.maximum ?? n.length ?? n.size;
		if (i >= 0) t.push([i, r]);
	}
	return t;
}
function Ni(e, t, r) {
	var n;
	for (let i = t; i < e.length; i++) (n = e[i]).schema ?? (n.schema = r);
}
function St(e, t, r) {
	var n;
	let i = e.inst?._zod?.traits;
	if (i?.has('$ZodType')) {
		if (i.has('$ZodCheck')) (n = e).schema ?? (n.schema = e.inst);
		else e.schema = e.inst;
	}
	let o = e.schema !== e.inst ? e.schema?._zod.def?.error : void 0,
		s = e.message
			? e.message
			: an(e.inst?._zod.def?.error?.(e)) ?? an(o?.(e)) ?? an(t?.error?.(e)) ?? an(r.customError?.(e))
				?? an(r.localeError?.(e)) ?? 'Invalid input',
		a = {};
	for (let c of Object.keys(e)) {
		if (c === 'inst' || c === 'schema' || c === 'continue' || c === 'input' || c === '__proto__') continue;
		a[c] = e[c];
	}
	if (a.path ?? (a.path = []), a.message = s, t?.reportInput) a.input = e.input;
	return a;
}
var iz = /[\uD800-\uDBFF]/;
function qi(e) {
	let t = e.length;
	if (!iz.test(e)) return t;
	let r = t;
	for (let n = 0; n < t - 1; n++) {
		if ((e.charCodeAt(n) & 64512) === 55296 && (e.charCodeAt(n + 1) & 64512) === 56320) r--, n++;
	}
	return r;
}
function Di(e) {
	if (Array.isArray(e)) return 'array';
	if (typeof e === 'string') return 'string';
	return 'unknown';
}
function _p(e) {
	let t = typeof e;
	switch (t) {
		case 'number':
			return Number.isNaN(e) ? 'nan' : 'number';
		case 'object': {
			if (e === null) return 'null';
			if (Array.isArray(e)) return 'array';
			let r = e;
			if (r && Object.getPrototypeOf(r) !== Object.prototype && 'constructor' in r && r.constructor) {
				return r.constructor.name;
			}
		}
	}
	return t;
}
function Zt(...e) {
	let [t, r, n] = e;
	if (typeof t === 'string') return { message: t, code: 'custom', input: r, inst: n };
	return { ...t };
}
function Cp(e, t) {
	for (let r in t) {
		let n = Object.getOwnPropertyDescriptor(t, r);
		if (n.get) Object.defineProperty(e, r, { ...n, enumerable: !1 });
		else oz(e, r, n.value);
	}
}
function at(e, t, r, n = !0) {
	return Object.defineProperty(e, t, { configurable: !0, writable: !0, enumerable: n, value: r }), r;
}
function Mi(e, t, r) {
	return at(e, t, r, !1);
}
function zp(e, t) {
	for (let r in e) {
		let n = e[r];
		Object.defineProperty(t, r, {
			configurable: !0,
			enumerable: !0,
			get() {
				return at(this, r, n(this));
			},
			set(i) {
				at(this, r, i);
			},
		});
	}
	return t;
}
function oz(e, t, r) {
	Object.defineProperty(e, t, {
		configurable: !0,
		get() {
			return this == null ? r : at(this, t, r.bind(this));
		},
		set(n) {
			at(this, t, n);
		},
	});
}
function sz(e, t) {
	let r = Object.getPrototypeOf(e);
	return t in r ? void 0 : r;
}
var ua,
	kt = !1,
	az = {
		configurable: !0,
		get() {
			kt = !0;
			return;
		},
	};
function Y(e, t, r) {
	let n = Object.getPrototypeOf(e._zod);
	if (t in n && ua !== e._zod) {
		ua = void 0;
		return;
	}
	ua = e._zod,
		Object.defineProperty(n, t, {
			configurable: !0,
			get() {
				Object.defineProperty(this, t, az);
				let i = kt;
				kt = !1;
				try {
					let o = r(this);
					if (kt) delete this[t];
					else Object.defineProperty(this, t, { configurable: !0, writable: !0, value: o });
					return kt = kt || i, o;
				} catch (o) {
					throw delete this[t], kt = kt || i, o;
				}
			},
			set(i) {
				Object.defineProperty(this, t, { configurable: !0, writable: !0, value: i });
			},
		});
}
function cz(e, t, r, n) {
	let i = sz(e, t);
	if (!i) return;
	Object.defineProperty(i, t, {
		configurable: !0,
		get() {
			let o = { configurable: !0, writable: !0, enumerable: n, value: void 0 };
			return Object.defineProperty(this, t, o), o.value = r(this), Object.defineProperty(this, t, o), o.value;
		},
		set(o) {
			Object.defineProperty(this, t, { configurable: !0, writable: !0, enumerable: n, value: o });
		},
	});
}
var uz = '~constantCatch';
function Tp(e) {
	let t = () => e;
	return t[uz] = !0, t;
}
var Ap;
var ga = { value: void 0, enumerable: !1 }, Ep = 'captureStackTrace' in Error ? Error : null;
function lz(e) {
	let t = Ep;
	if (t) {
		let r = t.stackTraceLimit;
		if (typeof r === 'number') {
			try {
				t.stackTraceLimit = 0;
			} catch {
				return Ep = null, new e();
			}
			try {
				return new e();
			} finally {
				t.stackTraceLimit = r;
			}
		}
	}
	return new e();
}
function E(e, t, r, n) {
	let i = {};
	function o(h) {
		this.def = h, this.constr = f, this.traits = new Set();
	}
	o.prototype = i;
	let s = r, a = s && new WeakSet();
	function c(h, d) {
		if (!h._zod) {
			ga.value = new o(d);
			try {
				Object.defineProperty(h, '_zod', ga);
			} finally {
				ga.value = void 0;
			}
		} else if (h._zod.traits.has(e)) return;
		if (h._zod.traits.add(e), t(h, d), a) {
			let y = Object.getPrototypeOf(h), x = h._zod.constr.prototype, k = y;
			while (k && k !== x) k = Object.getPrototypeOf(k);
			let z = k ?? y;
			if (!a.has(z)) a.add(z), Cp(z, s);
		}
		let g = f.prototype;
		for (let y in g) {
			if (!Object.prototype.hasOwnProperty.call(g, y)) continue;
			if (!(y in h)) h[y] = g[y].bind(h);
		}
	}
	let u = n?.Parent ?? Object;
	class l extends u {}
	Object.defineProperty(l, 'name', { value: e });
	function f(h) {
		let d = n?.Parent ? lz(l) : this;
		c(d, h);
		let g = d._zod.deferred;
		if (g) {
			for (let x of g) x();
			d._zod.deferred = void 0;
		}
		let y = globalThis.__zod_globalConfig?.postProcessor;
		if (y) y(d);
		return d;
	}
	return Object.defineProperty(f, 'init', { value: c }),
		Object.defineProperty(f, Symbol.hasInstance, {
			value: (h) => {
				if (n?.Parent && h instanceof n.Parent) return !0;
				return h?._zod?.traits?.has(e);
			},
		}),
		Object.defineProperty(f, 'name', { value: e }),
		f;
}
class Ye extends Error {
	constructor() {
		super('Encountered Promise during synchronous parse. Use .parseAsync() instead.');
	}
}
class fn extends Error {
	constructor(e) {
		super(`Encountered unidirectional transform during encode: ${e}`);
		this.name = 'ZodEncodeError';
	}
}
(Ap = globalThis).__zod_globalConfig ?? (Ap.__zod_globalConfig = {});
var Te = globalThis.__zod_globalConfig;
function Re(e) {
	if (e) Object.assign(Te, e);
	return Te;
}
function fz() {
	let e = this._zod;
	return e.message ?? (e.message = JSON.stringify(e.def, ln, 2)), e.message;
}
function pz(e) {
	this._zod.message = e;
}
var hz = { get: fz, set: pz, enumerable: !0, configurable: !0 },
	ba = { value: void 0, enumerable: !1 },
	Ip = new WeakSet([Object.prototype, Error.prototype]),
	Pp = (e, t) => {
		e.name = '$ZodError',
			ba.value = t,
			Object.defineProperty(e, 'issues', ba),
			ba.value = void 0,
			Object.defineProperty(e, 'message', hz);
		let r = Object.getPrototypeOf(e);
		if (!Ip.has(r)) {
			Ip.add(r),
				Object.defineProperty(r, 'toString', {
					configurable: !0,
					enumerable: !1,
					get() {
						let n = () => this.message;
						return Object.defineProperty(this, 'toString', { value: n, configurable: !0, writable: !0 }), n;
					},
					set(n) {
						Object.defineProperty(this, 'toString', { value: n, configurable: !0, writable: !0 });
					},
				});
		}
	},
	Op = E('$ZodError', Pp),
	Y$ = E('$ZodError', Pp, void 0, { Parent: Error });
function dz(e, t, r) {
	if (!Object.prototype.hasOwnProperty.call(e, t)) {
		if (t === '__proto__') {
			Object.defineProperty(e, t, { value: r(), writable: !0, enumerable: !0, configurable: !0 });
		} else e[t] = r();
	}
	return e[t];
}
function $p(e, t = (r) => r.message) {
	let r = {}, n = [];
	for (let i of e.issues) {
		if (i.path.length > 0) dz(r, i.path[0], () => []).push(t(i));
		else n.push(t(i));
	}
	return { formErrors: n, fieldErrors: r };
}
function Lp(e, t = (r) => r.message) {
	let r = { _errors: [] },
		n = (i, o = []) => {
			for (let s of i.issues) {
				if (s.code === 'invalid_union' && s.errors.length) s.errors.map((a) => n({ issues: a }, [...o, ...s.path]));
				else if (s.code === 'invalid_key') n({ issues: s.issues }, [...o, ...s.path]);
				else if (s.code === 'invalid_element') n({ issues: s.issues }, [...o, ...s.path]);
				else {
					let a = [...o, ...s.path];
					if (a.length === 0) r._errors.push(t(s));
					else {
						let c = r, u = 0;
						while (u < a.length) {
							let l = a[u], f = u === a.length - 1;
							if (l === '_errors') {
								if (f) c._errors.push(t(s));
								u++;
								continue;
							}
							if (!Object.prototype.hasOwnProperty.call(c, l)) {
								Object.defineProperty(c, l, { value: { _errors: [] }, enumerable: !0, writable: !0, configurable: !0 });
							}
							let h = c[l];
							if (f) h._errors.push(t(s));
							c = h, u++;
						}
					}
				}
			}
		};
	return n(e), r;
}
function Fi(e, t) {
	return { callee: t?.callee ?? e, Err: t?.Err };
}
var Ri = (e) => {
	let t = (r, n, i, o) => {
		let s = i ? { ...i, async: !1 } : { async: !1 }, a = r._zod.run({ value: n, issues: [] }, s);
		if (a instanceof Promise) throw new Ye();
		if (a.issues.length) {
			let c = new (o?.Err ?? e)(a.issues.map((u) => St(u, s, Re())));
			throw fa(c, o?.callee ?? t), c;
		}
		return a.value;
	};
	return t;
};
var Bi = (e) => {
	let t = async (r, n, i, o) => {
		let s = i ? { ...i, async: !0 } : { async: !0 }, a = r._zod.run({ value: n, issues: [] }, s);
		if (a instanceof Promise) a = await a;
		if (a.issues.length) {
			let c = new (o?.Err ?? e)(a.issues.map((u) => St(u, s, Re())));
			throw fa(c, o?.callee ?? t), c;
		}
		return a.value;
	};
	return t;
};
var Zi = (e) => (t, r, n) => {
	let i = n ? { ...n, async: !1 } : { async: !1 }, o = t._zod.run({ value: r, issues: [] }, i);
	if (o instanceof Promise) throw new Ye();
	return o.issues.length ? Np(e, o.issues, i) : { success: !0, data: o.value };
};
function Np(e, t, r) {
	let n;
	return {
		success: !1,
		get error() {
			if (!n) n = new e(t.map((i) => St(i, r, Re()))), t = void 0, r = void 0;
			return n;
		},
		set error(i) {
			n = i, t = void 0, r = void 0;
		},
	};
}
var ji = (e) => async (t, r, n) => {
	let i = n ? { ...n, async: !0 } : { async: !0 }, o = t._zod.run({ value: r, issues: [] }, i);
	if (o instanceof Promise) o = await o;
	return o.issues.length ? Np(e, o.issues, i) : { success: !0, data: o.value };
};
var mz = Symbol.for('zod.compile.invalid'),
	gz = Symbol.for('zod.compile.fallback'),
	xa = (e, t, r) => {
		let n = e._zod.bag.validator;
		if (n !== void 0) {
			if (n(t) !== mz) return !0;
			if (n.definite === !0 && r === void 0) return !1;
		}
		return yz(e, t, r);
	};
function yz(e, t, r) {
	let n = r ? { ...r, async: !1, abortEarly: !0 } : { async: !1, abortEarly: !0 }, i = e._zod.bag.fallbackRun, o;
	if (i) n[gz] = !0, o = i({ value: t, issues: [] }, n);
	else o = e._zod.run({ value: t, issues: [] }, n);
	if (o instanceof Promise) throw new Ye();
	return o.issues.length === 0;
}
var ka = async (e, t, r) => {
		let n = r ? { ...r, async: !0, abortEarly: !0 } : { async: !0, abortEarly: !0 },
			i = e._zod.run({ value: t, issues: [] }, n);
		if (i instanceof Promise) i = await i;
		return i.issues.length === 0;
	},
	qp = (e) => {
		let t = Ri(e),
			r = (n, i, o, s) => {
				let a = o ? { ...o, direction: 'backward' } : { direction: 'backward' };
				return t(n, i, a, Fi(r, s));
			};
		return r;
	};
var Dp = (e) => {
	let t = Ri(e), r = (n, i, o, s) => t(n, i, o, Fi(r, s));
	return r;
};
var Mp = (e) => {
	let t = Bi(e),
		r = async (n, i, o, s) => {
			let a = o ? { ...o, direction: 'backward' } : { direction: 'backward' };
			return await t(n, i, a, Fi(r, s));
		};
	return r;
};
var Fp = (e) => {
	let t = Bi(e), r = async (n, i, o, s) => await t(n, i, o, Fi(r, s));
	return r;
};
var Rp = (e) => (t, r, n) => {
	let i = n ? { ...n, direction: 'backward' } : { direction: 'backward' };
	return Zi(e)(t, r, i);
};
var Bp = (e) => (t, r, n) => Zi(e)(t, r, n);
var Zp = (e) => async (t, r, n) => {
	let i = n ? { ...n, direction: 'backward' } : { direction: 'backward' };
	return ji(e)(t, r, i);
};
var jp = (e) => async (t, r, n) => ji(e)(t, r, n);
var Up = /^[cC][0-9a-z]{6,}$/,
	Vp = /^[0-9a-z]+$/,
	Kp = /^[0-7][0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{25}$/,
	Jp = /^[0-9a-vA-V]{20}$/,
	Hp = /^[A-Za-z0-9]{27}$/,
	Gp = /^[a-zA-Z0-9_-]{21}$/;
function Wp(e) {
	return new RegExp(`^[a-zA-Z0-9_-]{${e}}$`);
}
var Yp = /^P(?:(\d+W)|(?!.*W)(?=\d|T\d)(\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+([.,]\d+)?S)?)?)$/;
var Qp = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/,
	Sa = (e) => {
		if (!e) {
			return /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/;
		}
		return new RegExp(`^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-${e}[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$`);
	};
var Xp = /^(?:[A-Za-z0-9_'+\-]+\.)*[A-Za-z0-9_'+\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/;
var bz =
	'^(?=[\\s\\S]*[\\p{Extended_Pictographic}\\p{Regional_Indicator}\\u20E3])[\\p{Extended_Pictographic}\\p{Emoji_Component}]+$';
function eh() {
	return new RegExp(bz, 'u');
}
var th =
		/^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/,
	rh =
		/^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))$/;
var nh =
		/^((25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/([0-9]|[1-2][0-9]|3[0-2])$/,
	ih =
		/^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/,
	oh = /^$|^(?:[0-9a-zA-Z+/]{4})*(?:(?:[0-9a-zA-Z+/]{2}==)|(?:[0-9a-zA-Z+/]{3}=))?$/,
	sh = /^(?:[A-Za-z0-9_-]{4})*(?:[A-Za-z0-9_-]{2,3})?$/;
var ah = /^https?$/, ch = /^\+[1-9]\d{6,14}$/;
var uh =
	'(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))';
function xz(e) {
	return new RegExp(`^${e}$`);
}
var lh = xz(uh);
function wa(e) {
	return typeof e.precision === 'number'
		? e.precision === -1
			? '(?:[01]\\d|2[0-3]):[0-5]\\d'
			: e.precision === 0
			? '(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d'
			: `(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d\\.\\d{${e.precision}}`
		: e.seconds
		? '(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?'
		: '(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?';
}
function fh(e) {
	return new RegExp(`^${wa(e)}$`);
}
function ph(e) {
	let t = ['Z'];
	if (e.offset) t.push('([+-](?:[01]\\d|2[0-3]):[0-5]\\d)');
	let r = `${wa({ precision: e.precision, seconds: !0 })}(?:${t.join('|')})`,
		n = e.local ? `${r}|${wa({ precision: e.precision })}` : r;
	return new RegExp(`^${uh}T(?:${n})$`);
}
var hh = /^[\s\S]{0,}$/;
var va = /^-?\d+(?:\.\d+)?$/;
var dh = /^[^A-Z]*$/, mh = /^[^a-z]*$/;
var de = E('$ZodCheck', (e, t) => {
	var r;
	e._zod ?? (e._zod = {}), e._zod.def = t, (r = e._zod).onattach ?? (r.onattach = []);
});
var _a = (e) => {
		let t = e.value;
		return !pp(t) && t.length !== void 0;
	},
	Ui = { number: 'number', bigint: 'bigint', object: 'date' },
	Ca = E('$ZodCheckLessThan', (e, t) => {
		de.init(e, t);
		let r = Ui[typeof t.value];
		e._zod.check = (n) => {
			if (t.inclusive ? n.value <= t.value : n.value < t.value) return;
			n.issues.push({
				origin: Ui[typeof n.value] ?? r,
				code: 'too_big',
				maximum: typeof t.value === 'object' ? t.value.getTime() : t.value,
				input: n.value,
				inclusive: t.inclusive,
				inst: e,
				continue: !t.abort,
			});
		};
	}),
	za = E('$ZodCheckGreaterThan', (e, t) => {
		de.init(e, t);
		let r = Ui[typeof t.value];
		e._zod.check = (n) => {
			if (t.inclusive ? n.value >= t.value : n.value > t.value) return;
			n.issues.push({
				origin: Ui[typeof n.value] ?? r,
				code: 'too_small',
				minimum: typeof t.value === 'object' ? t.value.getTime() : t.value,
				input: n.value,
				inclusive: t.inclusive,
				inst: e,
				continue: !t.abort,
			});
		};
	}),
	gh = E('$ZodCheckMultipleOf', (e, t) => {
		de.init(e, t),
			e._zod.check = (r) => {
				if (typeof r.value !== typeof t.value) throw Error('Cannot mix number and bigint in multiple_of check.');
				if (
					typeof r.value === 'bigint'
						? t.value !== BigInt(0) && r.value % t.value === BigInt(0)
						: hp(r.value, t.value) === 0
				) return;
				r.issues.push({
					origin: typeof r.value,
					code: 'not_multiple_of',
					divisor: t.value,
					input: r.value,
					inst: e,
					continue: !t.abort,
				});
			};
	}),
	yh = E('$ZodCheckNumberFormat', (e, t) => {
		de.init(e, t), t.format = t.format || 'float64';
		let r = t.format?.includes('int'), n = r ? 'int' : 'number', [i, o] = Oi[t.format];
		e._zod.check = (s) => {
			let a = s.value;
			if (r) {
				if (!Number.isInteger(a)) {
					s.issues.push({ expected: n, format: t.format, code: 'invalid_type', continue: !1, input: a, inst: e });
					return;
				}
				if (!Number.isSafeInteger(a)) {
					if (a > 0) {
						s.issues.push({
							input: a,
							code: 'too_big',
							maximum: Number.MAX_SAFE_INTEGER,
							note: 'Integers must be within the safe integer range.',
							inst: e,
							origin: n,
							inclusive: !0,
							continue: !t.abort,
						});
					} else {s.issues.push({
							input: a,
							code: 'too_small',
							minimum: Number.MIN_SAFE_INTEGER,
							note: 'Integers must be within the safe integer range.',
							inst: e,
							origin: n,
							inclusive: !0,
							continue: !t.abort,
						});}
					return;
				}
			}
			if (a < i) {
				s.issues.push({
					origin: 'number',
					input: a,
					code: 'too_small',
					minimum: i,
					inclusive: !0,
					inst: e,
					continue: !t.abort,
				});
			}
			if (a > o) {
				s.issues.push({
					origin: 'number',
					input: a,
					code: 'too_big',
					maximum: o,
					inclusive: !0,
					inst: e,
					continue: !t.abort,
				});
			}
		};
	});
var bh = E('$ZodCheckMaxLength', (e, t) => {
		var r;
		de.init(e, t),
			(r = e._zod.def).when ?? (r.when = _a),
			e._zod.check = (n) => {
				let i = n.value, o = i.length;
				if ((typeof i === 'string' && o > t.maximum ? qi(i) : o) <= t.maximum) return;
				let a = Di(i);
				n.issues.push({
					origin: a,
					code: 'too_big',
					maximum: t.maximum,
					inclusive: !0,
					input: i,
					inst: e,
					continue: !t.abort,
				});
			};
	}),
	xh = E('$ZodCheckMinLength', (e, t) => {
		var r;
		de.init(e, t),
			(r = e._zod.def).when ?? (r.when = _a),
			e._zod.check = (n) => {
				let i = n.value, o = i.length;
				if ((typeof i === 'string' && o >= t.minimum && o < t.minimum * 2 ? qi(i) : o) >= t.minimum) return;
				let a = Di(i);
				n.issues.push({
					origin: a,
					code: 'too_small',
					minimum: t.minimum,
					inclusive: !0,
					input: i,
					inst: e,
					continue: !t.abort,
				});
			};
	}),
	kh = E('$ZodCheckLengthEquals', (e, t) => {
		var r;
		de.init(e, t),
			(r = e._zod.def).when ?? (r.when = _a),
			e._zod.check = (n) => {
				let i = n.value, o = i.length, s = typeof i === 'string' && o >= t.length && o <= t.length * 2 ? qi(i) : o;
				if (s === t.length) return;
				let a = Di(i), c = s > t.length;
				n.issues.push({
					origin: a,
					...c ? { code: 'too_big', maximum: t.length } : { code: 'too_small', minimum: t.length },
					inclusive: !0,
					exact: !0,
					input: n.value,
					inst: e,
					continue: !t.abort,
				});
			};
	}),
	hn = E('$ZodCheckStringFormat', (e, t) => {
		var r, n;
		if (de.init(e, t), t.pattern) {
			(r = e._zod).check ?? (r.check = (i) => {
				if (t.pattern.lastIndex = 0, t.pattern.test(i.value)) return;
				i.issues.push({
					origin: 'string',
					code: 'invalid_format',
					format: t.format,
					input: i.value,
					...t.pattern ? { pattern: t.pattern.toString() } : {},
					inst: e,
					continue: !t.abort,
				});
			});
		} else (n = e._zod).check ?? (n.check = () => {});
	}),
	wh = E('$ZodCheckRegex', (e, t) => {
		hn.init(e, t),
			e._zod.check = (r) => {
				if (t.pattern.lastIndex = 0, t.pattern.test(r.value)) return;
				r.issues.push({
					origin: 'string',
					code: 'invalid_format',
					format: 'regex',
					input: r.value,
					pattern: t.pattern.toString(),
					inst: e,
					continue: !t.abort,
				});
			};
	}),
	Sh = E('$ZodCheckLowerCase', (e, t) => {
		t.pattern ?? (t.pattern = dh), hn.init(e, t);
	}),
	vh = E('$ZodCheckUpperCase', (e, t) => {
		t.pattern ?? (t.pattern = mh), hn.init(e, t);
	}),
	_h = E('$ZodCheckIncludes', (e, t) => {
		de.init(e, t);
		let r = wt(t.includes), n = new RegExp(typeof t.position === 'number' ? `^.{${t.position},}${r}` : r);
		t.pattern = n,
			e._zod.check = (i) => {
				if (i.value.includes(t.includes, t.position)) return;
				i.issues.push({
					origin: 'string',
					code: 'invalid_format',
					format: 'includes',
					includes: t.includes,
					input: i.value,
					inst: e,
					continue: !t.abort,
				});
			};
	}),
	Ch = E('$ZodCheckStartsWith', (e, t) => {
		de.init(e, t);
		let r = new RegExp(`^${wt(t.prefix)}.*`);
		t.pattern ?? (t.pattern = r),
			e._zod.check = (n) => {
				if (n.value.startsWith(t.prefix)) return;
				n.issues.push({
					origin: 'string',
					code: 'invalid_format',
					format: 'starts_with',
					prefix: t.prefix,
					input: n.value,
					inst: e,
					continue: !t.abort,
				});
			};
	}),
	zh = E('$ZodCheckEndsWith', (e, t) => {
		de.init(e, t);
		let r = new RegExp(`.*${wt(t.suffix)}$`);
		t.pattern ?? (t.pattern = r),
			e._zod.check = (n) => {
				if (n.value.endsWith(t.suffix)) return;
				n.issues.push({
					origin: 'string',
					code: 'invalid_format',
					format: 'ends_with',
					suffix: t.suffix,
					input: n.value,
					inst: e,
					continue: !t.abort,
				});
			};
	});
var Th = E('$ZodCheckOverwrite', (e, t) => {
	de.init(e, t),
		e._zod.check = (r) => {
			r.value = t.tx(r.value);
		};
});
class Ta {
	constructor(e = [], t = {}) {
		this.content = [], this.indent = 0, this.args = e, this.closed = t;
	}
	indented(e) {
		this.indent += 1;
		try {
			e(this);
		} finally {
			this.indent -= 1;
		}
	}
	write(e) {
		if (typeof e === 'function') {
			e(this, { execution: 'sync' }), e(this, { execution: 'async' });
			return;
		}
		let r = e.split(`
`).filter((o) => o),
			n = Math.min(...r.map((o) => o.length - o.trimStart().length)),
			i = r.map((o) => o.slice(n)).map((o) => ' '.repeat(this.indent * 2) + o);
		for (let o of i) this.content.push(o);
	}
	compile() {
		let e = Function, t = this?.content ?? [''];
		return new e(
			...Object.keys(this.closed),
			`return function (${this.args.join(', ')}) {
${
				t.join(`
`)
			}
};`,
		)(...Object.values(this.closed));
	}
}
var Eh = { major: 4, minor: 6, patch: 7 };
var ie = E('$ZodType', (e, t) => {
		var r;
		e ?? (e = {}), e._zod.def = t, e._zod.bag = e._zod.bag || {}, e._zod.version = Eh;
		let n = e._zod.def.checks, i = e._zod.traits.has('$ZodCheck') ? [e, ...n ?? []] : n?.length ? [...n] : [];
		for (let o of i) for (let s of o._zod.onattach) s(e);
		if (i.length === 0) {
			(r = e._zod).deferred ?? (r.deferred = []),
				e._zod.deferred?.push(() => {
					e._zod.run = e._zod.parse;
				});
		} else {
			let o = (a, c, u) => {
					if (a.memo) return a;
					let l = We(a), f;
					for (let h of c) {
						if (h._zod.def.when) {
							if (vp(a)) continue;
							if (!h._zod.def.when(a)) continue;
						} else if (l) continue;
						let d = a.issues.length, g = h._zod.check(a);
						if (g instanceof Promise && u?.async === !1) throw new Ye();
						if (f || g instanceof Promise) {
							f = (f ?? Promise.resolve()).then(async () => {
								if (await g, a.issues.length === d) return;
								if (Ni(a.issues, d, e), !l) l = We(a, d);
							});
						} else {
							if (a.issues.length === d) continue;
							if (Ni(a.issues, d, e), !l) l = We(a, d);
						}
					}
					if (f) return f.then(() => a);
					return a;
				},
				s = (a, c, u) => {
					if (We(a)) return a.aborted = !0, a;
					let l = o(c, i, u);
					if (l instanceof Promise) {
						if (u.async === !1) throw new Ye();
						return l.then((f) => e._zod.parse(f, u));
					}
					return e._zod.parse(l, u);
				};
			e._zod.run = (a, c) => {
				if (c.skipChecks) return e._zod.parse(a, c);
				if (c.direction === 'backward') {
					let l = e._zod.parse({ value: a.value, issues: [] }, { ...c, skipChecks: !0 });
					if (l instanceof Promise) return l.then((f) => s(f, a, c));
					return s(l, a, c);
				}
				let u = e._zod.parse(a, c);
				if (u instanceof Promise) {
					if (c.async === !1) throw new Ye();
					return u.then((l) => o(l, i, c));
				}
				return o(u, i, c);
			};
		}
	}, {
		get '~standard'() {
			return Mi(this, '~standard', Ea(this));
		},
		set '~standard'(e) {
			at(this, '~standard', e);
		},
	}),
	Rh = (e, t) => e.issues.length ? { issues: e.issues.map((r) => St(r, t, Re())) } : { value: e.value };
async function wz(e, t) {
	let r = { async: !0 };
	return Rh(await e._zod.run({ value: t, issues: [] }, r), r);
}
function Ea(e) {
	return {
		validate: (t) => {
			let r = { async: !1 };
			try {
				let n = e._zod.run({ value: t, issues: [] }, r);
				if (!(n instanceof Promise)) return Rh(n, r);
			} catch (n) {}
			return wz(e, t);
		},
		vendor: 'zod',
		version: 1,
	};
}
var Hi = E('$ZodString', (e, t) => {
		ie.init(e, t),
			e._zod.pattern = t.pattern ?? hh,
			e._zod.parse = (r, n) => {
				if (t.coerce) {
					try {
						r.value = String(r.value);
					} catch (i) {}
				}
				if (typeof r.value === 'string') return r;
				return r.issues.push({ expected: 'string', code: 'invalid_type', input: r.value, inst: e }), r;
			};
	}),
	ee = E('$ZodStringFormat', (e, t) => {
		hn.init(e, t), Hi.init(e, t);
	}),
	Bh = E('$ZodGUID', (e, t) => {
		t.pattern ?? (t.pattern = Qp), ee.init(e, t);
	}),
	Zh = E('$ZodUUID', (e, t) => {
		if (t.version) {
			let n = { v1: 1, v2: 2, v3: 3, v4: 4, v5: 5, v6: 6, v7: 7, v8: 8 }[t.version];
			if (n === void 0) throw Error(`Invalid UUID version: "${t.version}"`);
			t.pattern ?? (t.pattern = Sa(n));
		} else t.pattern ?? (t.pattern = Sa());
		ee.init(e, t);
	}),
	jh = E('$ZodEmail', (e, t) => {
		t.pattern ?? (t.pattern = Xp), ee.init(e, t);
	}),
	Uh = 1,
	Ki = 2;
function Vh(e) {
	try {
		if (typeof URL < 'u' && typeof URL.canParse === 'function') return URL.canParse(e);
		return new URL(e), !0;
	} catch {
		return !1;
	}
}
function Sz(e, t) {
	if (!('normalize' in t) && !('hostname' in t) && !('protocol' in t)) return Vh(e) || Ki;
	return vz(e, t);
}
function vz(e, t) {
	if (!t.normalize && t.protocol?.source === ah.source && !/^https?:\/\//i.test(e)) return Uh;
	try {
		if (typeof URL < 'u') {
			let r = URL;
			if (typeof r.parse === 'function') return r.parse(e) ?? Ki;
		}
		return new URL(e);
	} catch {
		return Ki;
	}
}
var _z = /[\t\n\r]/g;
function Ih(e) {
	return e.replace(_z, '');
}
function Cz(e, t) {
	return t.lastIndex = 0, t.test(e.hostname);
}
function zz(e, t) {
	return t.lastIndex = 0, t.test(e.protocol.endsWith(':') ? e.protocol.slice(0, -1) : e.protocol);
}
var Kh = E('$ZodURL', (e, t) => {
		ee.init(e, t),
			e._zod.check = (r) => {
				try {
					let n = r.value.trim(), i = Sz(n, t);
					if (i === Uh) {
						r.issues.push({
							code: 'invalid_format',
							format: 'url',
							note: 'Invalid URL format',
							input: r.value,
							inst: e,
							continue: !t.abort,
						});
						return;
					}
					if (i === Ki) {
						r.issues.push({ code: 'invalid_format', format: 'url', input: r.value, inst: e, continue: !t.abort });
						return;
					}
					if (i === !0) {
						r.value = Ih(n);
						return;
					}
					if (t.hostname && !Cz(i, t.hostname)) {
						r.issues.push({
							code: 'invalid_format',
							format: 'url',
							note: 'Invalid hostname',
							pattern: t.hostname.source,
							input: r.value,
							inst: e,
							continue: !t.abort,
						});
					}
					if (t.protocol && !zz(i, t.protocol)) {
						r.issues.push({
							code: 'invalid_format',
							format: 'url',
							note: 'Invalid protocol',
							pattern: t.protocol.source,
							input: r.value,
							inst: e,
							continue: !t.abort,
						});
					}
					r.value = t.normalize ? i.href : Ih(n);
					return;
				} catch (n) {
					r.issues.push({ code: 'invalid_format', format: 'url', input: r.value, inst: e, continue: !t.abort });
				}
			};
	}),
	Jh = E('$ZodEmoji', (e, t) => {
		t.pattern ?? (t.pattern = eh()), ee.init(e, t);
	}),
	Hh = E('$ZodNanoID', (e, t) => {
		if (t.length !== void 0 && (!Number.isInteger(t.length) || t.length < 1)) {
			throw Error(`Invalid nanoid length: ${t.length}`);
		}
		t.pattern ?? (t.pattern = t.length === void 0 ? Gp : Wp(t.length)), ee.init(e, t);
	}),
	Gh = E('$ZodCUID', (e, t) => {
		t.pattern ?? (t.pattern = Up), ee.init(e, t);
	}),
	Wh = E('$ZodCUID2', (e, t) => {
		t.pattern ?? (t.pattern = Vp), ee.init(e, t);
	}),
	Yh = E('$ZodULID', (e, t) => {
		t.pattern ?? (t.pattern = Kp), ee.init(e, t);
	}),
	Qh = E('$ZodXID', (e, t) => {
		t.pattern ?? (t.pattern = Jp), ee.init(e, t);
	}),
	Xh = E('$ZodKSUID', (e, t) => {
		t.pattern ?? (t.pattern = Hp), ee.init(e, t);
	}),
	ed = E('$ZodISODateTime', (e, t) => {
		t.pattern ?? (t.pattern = ph(t)), ee.init(e, t);
	}),
	td = E('$ZodISODate', (e, t) => {
		t.pattern ?? (t.pattern = lh), ee.init(e, t);
	}),
	rd = E('$ZodISOTime', (e, t) => {
		t.pattern ?? (t.pattern = fh(t)), ee.init(e, t);
	}),
	nd = E('$ZodISODuration', (e, t) => {
		t.pattern ?? (t.pattern = Yp), ee.init(e, t);
	}),
	id = E('$ZodIPv4', (e, t) => {
		t.pattern ?? (t.pattern = th), ee.init(e, t);
	}),
	Tz = /^[0-9a-fA-F:.]+$/;
function od(e) {
	if (!Tz.test(e)) return !1;
	return Vh(`http://[${e}]`);
}
var sd = E('$ZodIPv6', (e, t) => {
	t.pattern ?? (t.pattern = rh),
		ee.init(e, t),
		e._zod.check = (r) => {
			if (!od(r.value)) {
				r.issues.push({ code: 'invalid_format', format: 'ipv6', input: r.value, inst: e, continue: !t.abort });
			}
		};
});
var ad = E('$ZodCIDRv4', (e, t) => {
	t.pattern ?? (t.pattern = nh), ee.init(e, t);
});
function Az(e) {
	let t = e.split('/');
	if (t.length !== 2) return !1;
	let [r, n] = t;
	if (!n) return !1;
	let i = Number(n);
	if (`${i}` !== n) return !1;
	if (i < 0 || i > 128) return !1;
	return od(r);
}
var cd = E('$ZodCIDRv6', (e, t) => {
	t.pattern ?? (t.pattern = ih),
		ee.init(e, t),
		e._zod.check = (r) => {
			if (!Az(r.value)) {
				r.issues.push({ code: 'invalid_format', format: 'cidrv6', input: r.value, inst: e, continue: !t.abort });
			}
		};
});
function ud(e) {
	if (e === '') return !0;
	if (/\s/.test(e)) return !1;
	if (e.length % 4 !== 0) return !1;
	try {
		return atob(e), !0;
	} catch {
		return !1;
	}
}
var Ia = /^[0-9a-zA-Z+/]*={0,2}$/,
	ld = E('$ZodBase64', (e, t) => {
		t.pattern ?? (t.pattern = Ia),
			ee.init(e, t),
			e._zod.check = (r) => {
				if (ud(r.value)) return;
				r.issues.push({ code: 'invalid_format', format: 'base64', input: r.value, inst: e, continue: !t.abort });
			};
	}),
	Gi = /^[A-Za-z0-9_-]*$/;
function Ez(e) {
	if (!Gi.test(e)) return !1;
	let t = e.replace(/[-_]/g, (n) => n === '-' ? '+' : '/'), r = t.padEnd(Math.ceil(t.length / 4) * 4, '=');
	return ud(r);
}
var fd = E('$ZodBase64URL', (e, t) => {
		t.pattern ?? (t.pattern = Gi),
			ee.init(e, t),
			e._zod.check = (r) => {
				if (Ez(r.value)) return;
				r.issues.push({ code: 'invalid_format', format: 'base64url', input: r.value, inst: e, continue: !t.abort });
			};
	}),
	pd = E('$ZodE164', (e, t) => {
		t.pattern ?? (t.pattern = ch), ee.init(e, t);
	});
function Iz(e, t = null) {
	try {
		let r = e.split('.');
		if (r.length !== 3) return !1;
		let [n] = r;
		if (!n) return !1;
		let i = JSON.parse(atob(n));
		if ('typ' in i && i?.typ !== 'JWT') return !1;
		if (!i.alg) return !1;
		if (t && (!('alg' in i) || i.alg !== t)) return !1;
		return !0;
	} catch {
		return !1;
	}
}
var hd = E('$ZodJWT', (e, t) => {
	ee.init(e, t),
		e._zod.check = (r) => {
			if (Iz(r.value, t.alg)) return;
			r.issues.push({ code: 'invalid_format', format: 'jwt', input: r.value, inst: e, continue: !t.abort });
		};
});
var Pa = E('$ZodNumber', (e, t) => {
		ie.init(e, t),
			e._zod.pattern = va,
			e._zod.parse = (r, n) => {
				if (t.coerce) {
					try {
						r.value = Number(r.value);
					} catch (s) {}
				}
				let i = r.value;
				if (typeof i === 'number' && !Number.isNaN(i) && Number.isFinite(i)) return r;
				let o = typeof i === 'number' ? Number.isNaN(i) ? 'NaN' : !Number.isFinite(i) ? String(i) : void 0 : void 0;
				return r.issues.push({
					expected: 'number',
					code: 'invalid_type',
					input: i,
					inst: e,
					...o ? { received: o } : {},
				}),
					r;
			};
	}),
	dd = E('$ZodNumberFormat', (e, t) => {
		yh.init(e, t), Pa.init(e, t);
	});
var md = E('$ZodUnknown', (e, t) => {
		ie.init(e, t), e._zod.parse = (r) => r;
	}),
	gd = E('$ZodNever', (e, t) => {
		ie.init(e, t),
			e._zod.parse = (r, n) => (r.issues.push({ expected: 'never', code: 'invalid_type', input: r.value, inst: e }), r);
	});
function Pz(e, t) {
	let r = ma(e._zod.def.checks);
	if (!r.length) return;
	let n = Math.min(...r.map((o) => o[0])), i = e._zod.parse;
	e._zod.parse = (o, s) => {
		let a = t(o.value);
		if (a > n && !s?.skipChecks && s?.direction !== 'backward') {
			for (let [c, u] of ma(e._zod.def.checks)) {
				if (a > c && u._zod.def.when(o)) {
					let l = o.issues.length;
					return u._zod.check(o), o.issues[l].continue = !1, Ni(o.issues, l, e), o;
				}
			}
		}
		return i(o, s);
	};
}
var Oz = (e) => Array.isArray(e) ? e.length : -1;
function Ph(e, t, r) {
	if (e.issues.length) t.issues.push(...Li(r, e.issues));
	t.value[r] = e.value;
}
var yd = E('$ZodArray', (e, t) => {
	ie.init(e, t);
	let r = Te.memoizer;
	r?.attach(e),
		e._zod.parse = (n, i) => {
			let o = n.value;
			if (!Array.isArray(o)) return n.issues.push({ expected: 'array', code: 'invalid_type', input: o, inst: e }), n;
			n.value = r ? r.alloc(e, n, Array(o.length), i) : Array(o.length);
			let s = [], a = i?.abortEarly;
			for (let c = 0; c < o.length; c++) {
				let u = o[c], l = t.element._zod.run({ value: u, issues: [] }, i);
				if (l instanceof Promise) s.push(l.then((f) => Ph(f, n, c)));
				else if (Ph(l, n, c), a && l.issues.length !== 0 && We(l)) break;
			}
			if (s.length) return Promise.all(s).then(() => n);
			return n;
		},
		Pz(e, Oz);
});
function Ji(e, t, r, n, i, o) {
	let s = r in n, a = o === 'optional';
	if (!s && a && i === 'optional') return;
	if (e.issues.length) {
		if (i !== void 0 && a && !s) return;
		t.issues.push(...Li(r, e.issues));
	}
	if (!s && i === void 0) {
		if (!e.issues.length) t.issues.push({ code: 'invalid_type', expected: 'nonoptional', input: void 0, path: [r] });
		return;
	}
	if (e.value === void 0) { if (s || i === 'defaulted' && !a) t.value[r] = void 0; }
	else t.value[r] = e.value;
}
var $z = [];
function bd(e) {
	let t = Object.keys(e.shape),
		r = Object.getOwnPropertySymbols(e.shape),
		n = r.length ? r : $z,
		i = n.length ? [...t, ...n] : t;
	for (let s of i) {
		if (!e.shape?.[s]?._zod?.traits?.has('$ZodType')) {
			throw Error(`Invalid element at key "${String(s)}": expected a Zod schema`);
		}
	}
	let o = kp(e.shape);
	return { ...e, allKeys: i, symbolKeys: n, keySet: new Set(t), numKeys: t.length, optionalKeys: new Set(o) };
}
function xd(e, t, r, n, i, o, s) {
	let a = [], c = i.keySet, u = i.catchall._zod, l = u.def.type, { optin: f, optout: h } = u, d = 0;
	for (let g in t) {
		if (s && r.issues.length !== d) {
			if (We(r, d)) break;
			d = r.issues.length;
		}
		if (c.has(g)) continue;
		if (g === '__proto__') {
			if (l === 'never') a.push(g);
			continue;
		}
		if (l === 'never') {
			a.push(g);
			continue;
		}
		let y = u.run({ value: t[g], issues: [] }, n);
		if (y instanceof Promise) e.push(y.then((x) => Ji(x, r, g, t, f, h)));
		else Ji(y, r, g, t, f, h);
	}
	if (a.length) r.issues.push({ code: 'unrecognized_keys', keys: a, input: t, inst: o, continue: !0 });
	if (!e.length) return r;
	return Promise.all(e).then(() => r);
}
var Lz = E('$ZodObject', (e, t) => {
		ie.init(e, t);
		let r = Object.getOwnPropertyDescriptor(t, 'shape'), n = r?.get ? r.get.raw : t.shape ?? {};
		if (n) {
			let u = () => {
				let l = { ...n };
				return Object.defineProperty(t, 'shape', { value: l }), u.raw = l, l;
			};
			u.raw = n, Object.defineProperty(t, 'shape', { get: u });
		}
		let i = Ei(() => bd(t));
		Y(e, 'propValues', (u) => {
			let l = u.def.shape, f = {};
			for (let h in l) {
				let d = l[h]._zod;
				if (d.values) {
					if (!Object.prototype.hasOwnProperty.call(f, h)) He(f, h, new Set());
					for (let g of d.values) f[h].add(g);
					if (d.optin !== void 0) f[h].add(void 0);
				}
			}
			return f;
		});
		let o = cn, s = t.catchall, a, c = Te.memoizer;
		c?.attach(e),
			e._zod.parse = (u, l) => {
				a ?? (a = i.value);
				let f = u.value;
				if (!o(f)) return u.issues.push({ expected: 'object', code: 'invalid_type', input: f, inst: e }), u;
				u.value = c ? c.alloc(e, u, {}, l) : {};
				let h = [], d = a.shape, g = l?.abortEarly, y = u.issues.length;
				for (let x of a.allKeys) {
					if (g && u.issues.length !== y) {
						if (We(u, y)) break;
						y = u.issues.length;
					}
					if (x === '__proto__') continue;
					let k = d[x], z = k._zod.optin, _ = k._zod.optout, O = k._zod.run({ value: f[x], issues: [] }, l);
					if (O instanceof Promise) h.push(O.then((I) => Ji(I, u, x, f, z, _)));
					else Ji(O, u, x, f, z, _);
				}
				if (!s) return h.length ? Promise.all(h).then(() => u) : u;
				return xd(h, f, u, l, i.value, e, g === !0);
			};
	}),
	kd = E('$ZodObjectJIT', (e, t) => {
		Lz.init(e, t);
		let r = e._zod.parse,
			n = Ei(() => bd(t)),
			i = Te.memoizer,
			o = (d) => {
				let g = n.value,
					y = g.symbolKeys,
					x = new Ta(['payload', 'ctx'], { shape: d, inst: e, memo: i, syms: y }),
					k = (I) => `shape[${I}]._zod.run({ value: input[${I}], issues: [] }, ctx)`,
					z = (I, v) => `
          let ${I}_ab = false;
          for (let i = 0; i < ${I}.issues.length; i++) {
            const iss = ${I}.issues[i];
            iss.path = iss.path ? [${v}, ...iss.path] : [${v}];
            payload.issues.push(iss);
            if (iss.continue !== true) ${I}_ab = true;
          }
          if (${I}_ab && ctx && ctx.abortEarly) {
            payload.value = newResult;
            return payload;
          }`;
				x.write('const input = payload.value;');
				let _ = Object.create(null), O = 0;
				for (let I of g.allKeys) _[I] = `key_${O++}`;
				x.write(i ? 'const newResult = memo.alloc(inst, payload, {}, ctx);' : 'const newResult = {};');
				for (let I of g.allKeys) {
					if (I === '__proto__') continue;
					let v = _[I],
						q = typeof I === 'symbol' ? `syms[${y.indexOf(I)}]` : gp(I),
						L = `${q} in input`,
						U = d[I],
						C = U?._zod?.optin,
						J = C !== void 0,
						Z = U?._zod?.optout === 'optional';
					if (x.write(`const ${v} = ${k(q)};`), J && Z) {
						let M = C === 'optional' ? `${v}_present` : `${v}.value !== undefined || ${v}_present`;
						x.write(`
        const ${v}_present = ${L};
        if (!${v}.issues.length || ${v}_present) {
          if (${v}.issues.length) {${z(v, q)}
          }

          if (${M}) {
            newResult[${q}] = ${v}.value;
          }
        }

      `);
					} else if (!J) {
						x.write(`
        const ${v}_present = ${L};
        if (${v}.issues.length) {${z(v, q)}
        }
        if (!${v}_present && !${v}.issues.length) {
          payload.issues.push({
            code: "invalid_type",
            expected: "nonoptional",
            input: undefined,
            path: [${q}]
          });
          if (ctx && ctx.abortEarly) {
            payload.value = newResult;
            return payload;
          }
        }

        if (${v}_present) {
          newResult[${q}] = ${v}.value;
        }

      `);
					} else if (
						x.write(`
        if (${v}.issues.length) {${z(v, q)}
        }
      `),
							C === 'defaulted'
					) x.write(`newResult[${q}] = ${v}.value;`);
					else {x.write(`
        if (${v}.value !== undefined || ${L}) {
          newResult[${q}] = ${v}.value;
        }
      `);}
				}
				return x.write('payload.value = newResult;'), x.write('return payload;'), x.compile();
			},
			s,
			a = cn,
			c = !Te.jitless,
			l = c && bp.value,
			f = t.catchall,
			h;
		e._zod.parse = (d, g) => {
			h ?? (h = n.value);
			let y = d.value;
			if (!a(y)) return d.issues.push({ expected: 'object', code: 'invalid_type', input: y, inst: e }), d;
			if (c && l && g?.async === !1 && g.jitless !== !0) {
				if (!s) s = o(t.shape);
				if (d = s(d, g), !f) return d;
				return xd([], y, d, g, h, e, g?.abortEarly === !0);
			}
			return r(d, g);
		};
	});
function Oh(e, t, r, n) {
	for (let o of e) if (o.issues.length === 0) return t.value = o.value, t;
	let i = e.filter((o) => !We(o));
	if (i.length === 1) return t.value = i[0].value, i[0];
	return t.issues.push({
		code: 'invalid_union',
		input: t.value,
		inst: r,
		errors: e.map((o) => o.issues.map((s) => St(s, n, Re()))),
	}),
		t;
}
var wd = E('$ZodUnion', (e, t) => {
	ie.init(e, t),
		Y(
			e,
			'optin',
			(n) =>
				n.def.options.some((i) => i._zod.optin === 'defaulted')
					? 'defaulted'
					: n.def.options.some((i) => i._zod.optin !== void 0)
					? 'optional'
					: void 0,
		),
		Y(e, 'optout', (n) => n.def.options.some((i) => i._zod.optout === 'optional') ? 'optional' : void 0),
		Y(e, 'values', (n) => {
			if (n.def.options.every((i) => i._zod.values)) {
				return new Set(n.def.options.flatMap((i) => Array.from(i._zod.values)));
			}
			return;
		}),
		Y(e, 'pattern', (n) => {
			if (n.def.options.every((i) => i._zod.pattern)) {
				let i = n.def.options.map((o) => o._zod.pattern);
				return new RegExp(`^(${i.map((o) => Ii(o.source)).join('|')})$`);
			}
			return;
		});
	let r = t.options.length === 1 ? t.options[0]._zod.run : null;
	e._zod.parse = (n, i) => {
		if (r) return r(n, i);
		let o = !1, s = [];
		for (let a of t.options) {
			let c = a._zod.run({ value: n.value, issues: [] }, i);
			if (c instanceof Promise) s.push(c), o = !0;
			else {
				if (c.issues.length === 0) return c;
				s.push(c);
			}
		}
		if (!o) return Oh(s, n, e, i);
		return Promise.all(s).then((a) => Oh(a, n, e, i));
	};
});
var Sd = E('$ZodIntersection', (e, t) => {
	ie.init(e, t),
		e._zod.parse = (r, n) => {
			let i = r.value,
				o = t.left._zod.run({ value: i, issues: [] }, n),
				s = t.right._zod.run({ value: i, issues: [] }, n);
			if (o instanceof Promise || s instanceof Promise) return Promise.all([o, s]).then(([c, u]) => $h(r, c, u));
			return $h(r, o, s);
		};
});
function Aa(e, t) {
	if (e === t) return { valid: !0, data: e };
	if (e instanceof Date && t instanceof Date && +e === +t) return { valid: !0, data: e };
	if (xr(e) && xr(t)) {
		let r = Object.keys(t), n = Object.keys(e).filter((o) => r.indexOf(o) !== -1), i = { ...e, ...t };
		if (Object.prototype.hasOwnProperty.call(i, '__proto__')) delete i.__proto__;
		for (let o of n) {
			if (o === '__proto__') continue;
			let s = Aa(e[o], t[o]);
			if (!s.valid) return { valid: !1, mergeErrorPath: [o, ...s.mergeErrorPath] };
			i[o] = s.data;
		}
		return { valid: !0, data: i };
	}
	if (Array.isArray(e) && Array.isArray(t)) {
		if (e.length !== t.length) return { valid: !1, mergeErrorPath: [] };
		let r = [];
		for (let n = 0; n < e.length; n++) {
			let i = e[n], o = t[n], s = Aa(i, o);
			if (!s.valid) return { valid: !1, mergeErrorPath: [n, ...s.mergeErrorPath] };
			r.push(s.data);
		}
		return { valid: !0, data: r };
	}
	return { valid: !1, mergeErrorPath: [] };
}
function $h(e, t, r) {
	let n = new Map(),
		i,
		o = new Map(),
		s = (u, l) => {
			let f;
			if (u.code === 'unrecognized_keys' && !u.path?.length) i ?? (i = u), f = u.keys;
			else if (u.code === 'invalid_key' && u.origin === 'record' && u.path?.length === 1) {
				let h = String(u.path[0]);
				if (!o.has(h)) o.set(h, u);
				f = [h];
			} else return !1;
			for (let h of f) {
				if (!n.has(h)) n.set(h, {});
				n.get(h)[l] = !0;
			}
			return !0;
		};
	for (let u of t.issues) if (!s(u, 'l')) e.issues.push(u);
	for (let u of r.issues) if (!s(u, 'r')) e.issues.push(u);
	let a = [...n].filter(([, u]) => u.l && u.r).map(([u]) => u);
	if (a.length) {
		let u = i ? a.filter((l) => i.keys.includes(l)) : [];
		if (u.length) e.issues.push({ ...i, keys: u });
		for (let l of a) if (!u.includes(l) && o.has(l)) e.issues.push(o.get(l));
	}
	let c = Aa(t.value, r.value);
	if (!c.valid) {
		if (We(e)) return e;
		throw Error(`Unmergable intersection. Error path: ${JSON.stringify(c.mergeErrorPath)}`);
	}
	return e.value = c.data, e;
}
var vd = E('$ZodEnum', (e, t) => {
		ie.init(e, t);
		let r = un(t.entries), n = new Set(r);
		e._zod.values = n,
			Y(e, 'pattern', (i) => {
				let o = un(i.def.entries).filter((s) => xp.has(typeof s));
				return new RegExp(o.length ? `^(${o.map((s) => wt(s.toString())).join('|')})$` : '^[^\\s\\S]$');
			}),
			e._zod.parse = (i, o) => {
				let s = i.value;
				if (n.has(s)) return i;
				return i.issues.push({ code: 'invalid_value', values: r, input: s, inst: e }), i;
			};
	}),
	_d = E('$ZodLiteral', (e, t) => {
		ie.init(e, t);
		let r = new Set(t.values);
		e._zod.values = r,
			Y(e, 'pattern', (n) => {
				let i = n.def.values;
				return new RegExp(
					i.length
						? `^(${i.map((o) => typeof o === 'string' ? wt(o) : o ? wt(o.toString()) : String(o)).join('|')})$`
						: '^[^\\s\\S]$',
				);
			}),
			e._zod.parse = (n, i) => {
				let o = n.value;
				if (r.has(o)) return n;
				return n.issues.push({ code: 'invalid_value', values: t.values, input: o, inst: e }), n;
			};
	});
var Cd = E('$ZodTransform', (e, t) => {
	ie.init(e, t),
		e._zod.optin = 'optional',
		Te.memoizer?.guard(e),
		e._zod.parse = (r, n) => {
			if (n.direction === 'backward') throw new fn(e.constructor.name);
			let i = t.transform(r.value, r);
			if (n.async) return (i instanceof Promise ? i : Promise.resolve(i)).then((s) => (r.value = s, r));
			if (i instanceof Promise) throw new Ye();
			return r.value = i, r;
		};
});
function Lh(e, t) {
	return e.value = t.issues.length ? void 0 : t.value, e;
}
var Oa = E('$ZodOptional', (e, t) => {
		ie.init(e, t),
			Y(e, 'optin', (r) => r.def.innerType._zod.optin === 'defaulted' ? 'defaulted' : 'optional'),
			e._zod.optout = 'optional',
			Y(e, 'values', (r) => {
				let n = r.def.innerType._zod.values;
				return n ? new Set([...n, void 0]) : void 0;
			}),
			Y(e, 'pattern', (r) => {
				let n = r.def.innerType._zod.pattern;
				return n ? new RegExp(`^(${Ii(n.source)})?$`) : void 0;
			}),
			e._zod.parse = (r, n) => {
				if (r.value === void 0) {
					if (t.innerType._zod.optin !== 'defaulted') return r;
					let i = t.innerType._zod.run({ value: r.value, issues: [] }, n);
					if (i instanceof Promise) return i.then((o) => Lh(r, o));
					return Lh(r, i);
				}
				return t.innerType._zod.run(r, n);
			};
	}),
	zd = E('$ZodExactOptional', (e, t) => {
		Oa.init(e, t),
			Y(e, 'values', (r) => r.def.innerType._zod.values),
			Y(e, 'pattern', (r) => r.def.innerType._zod.pattern),
			e._zod.parse = (r, n) => t.innerType._zod.run(r, n);
	}),
	Td = E('$ZodNullable', (e, t) => {
		ie.init(e, t),
			Y(e, 'optin', (r) => r.def.innerType._zod.optin),
			Y(e, 'optout', (r) => r.def.innerType._zod.optout),
			Y(e, 'pattern', (r) => {
				let n = r.def.innerType._zod.pattern;
				return n ? new RegExp(`^(${Ii(n.source)}|null)$`) : void 0;
			}),
			Y(e, 'values', (r) => r.def.innerType._zod.values ? new Set([...r.def.innerType._zod.values, null]) : void 0),
			e._zod.parse = (r, n) => {
				if (r.value === null) return r;
				return t.innerType._zod.run(r, n);
			};
	}),
	Ad = E('$ZodDefault', (e, t) => {
		ie.init(e, t),
			e._zod.optin = 'defaulted',
			Y(e, 'values', (r) => r.def.innerType._zod.values),
			e._zod.parse = (r, n) => {
				if (n.direction === 'backward') return t.innerType._zod.run(r, n);
				if (r.value === void 0) return r.value = t.defaultValue, r;
				let i = t.innerType._zod.run(r, n);
				if (i instanceof Promise) return i.then((o) => Nh(o, t));
				return Nh(i, t);
			};
	});
function Nh(e, t) {
	if (e.value === void 0) e.value = t.defaultValue;
	return e;
}
var Ed = E('$ZodPrefault', (e, t) => {
		ie.init(e, t),
			e._zod.optin = 'defaulted',
			Y(e, 'values', (r) => r.def.innerType._zod.values),
			e._zod.parse = (r, n) => {
				if (n.direction === 'backward') return t.innerType._zod.run(r, n);
				if (r.value === void 0) r.value = t.defaultValue;
				return t.innerType._zod.run(r, n);
			};
	}),
	Id = E('$ZodNonOptional', (e, t) => {
		ie.init(e, t),
			Y(e, 'values', (r) => {
				let n = r.def.innerType._zod.values;
				return n ? new Set([...n].filter((i) => i !== void 0)) : void 0;
			}),
			e._zod.parse = (r, n) => {
				let i = t.innerType._zod.run(r, n);
				if (i instanceof Promise) return i.then((o) => qh(o, e));
				return qh(i, e);
			};
	});
function qh(e, t) {
	if (!e.issues.length && e.value === void 0) {
		e.issues.push({ code: 'invalid_type', expected: 'nonoptional', input: e.value, inst: t });
	}
	return e;
}
function Dh(e, t, r, n) {
	if (!t.issues.length) {
		if (e.value = t.value, t.memo) e.memo = !0;
		return e;
	}
	return e.value = r.catchValue({
		...t,
		value: e.value,
		error: { issues: t.issues.map((i) => St(i, n, Re())) },
		input: e.value,
	}),
		e;
}
var Pd = E('$ZodCatch', (e, t) => {
	ie.init(e, t),
		Y(e, 'optin', (r) => r.def.innerType._zod.optin === 'defaulted' ? 'defaulted' : 'optional'),
		Y(e, 'optout', (r) => r.def.innerType._zod.optout),
		Y(e, 'values', (r) => r.def.innerType._zod.values),
		e._zod.parse = (r, n) => {
			if (n.direction === 'backward') return t.innerType._zod.run(r, n);
			let i = t.innerType._zod.run({ value: r.value, issues: [] }, n);
			if (i instanceof Promise) return i.then((o) => Dh(r, o, t, n));
			return Dh(r, i, t, n);
		};
});
var Od = E('$ZodPipe', (e, t) => {
	ie.init(e, t),
		Y(e, 'values', (r) => r.def.in._zod.values),
		Y(e, 'optin', (r) => r.def.in._zod.optin),
		Y(e, 'optout', (r) => r.def.out._zod.optout),
		Y(e, 'propValues', (r) => r.def.in._zod.propValues),
		e._zod.parse = (r, n) => {
			if (n.direction === 'backward') {
				let o = t.out._zod.run(r, n);
				if (o instanceof Promise) return o.then((s) => Vi(s, t.in, n));
				return Vi(o, t.in, n);
			}
			let i = t.in._zod.run(r, n);
			if (i instanceof Promise) return i.then((o) => Vi(o, t.out, n));
			return Vi(i, t.out, n);
		};
});
function Vi(e, t, r) {
	if (e.issues.some((n) => n.code !== 'unrecognized_keys')) return e.aborted = !0, e;
	return t._zod.run({ value: e.value, issues: e.issues }, r);
}
var $d = E('$ZodReadonly', (e, t) => {
	ie.init(e, t),
		Y(e, 'propValues', (r) => r.def.innerType._zod.propValues),
		Y(e, 'values', (r) => r.def.innerType._zod.values),
		Y(e, 'optin', (r) => r.def.innerType?._zod?.optin),
		Y(e, 'optout', (r) => r.def.innerType?._zod?.optout),
		e._zod.parse = (r, n) => {
			if (n.direction === 'backward') return t.innerType._zod.run(r, n);
			let i = t.innerType._zod.run(r, n);
			if (i instanceof Promise) return i.then(Mh);
			return Mh(i);
		};
});
function Mh(e) {
	if (!e.memo) e.value = Object.freeze(e.value);
	return e;
}
var Ld = E('$ZodCustom', (e, t) => {
	de.init(e, t),
		ie.init(e, t),
		e._zod.parse = (r, n) => r,
		e._zod.check = (r) => {
			let n = r.value, i = t.fn(n);
			if (i instanceof Promise) return i.then((o) => Fh(o, r, n, e));
			Fh(i, r, n, e);
			return;
		};
});
function Fh(e, t, r, n) {
	if (!e) {
		let i = { code: 'custom', input: r, inst: n, path: [...n._zod.def.path ?? []], continue: !n._zod.def.abort };
		if (n._zod.def.params) i.params = n._zod.def.params;
		t.issues.push(Zt(i));
	}
}
class qd extends Error {
	constructor() {
		super('Cannot parse a reference cycle that closes through a transform');
		this.name = 'ZodCyclicError';
	}
}
var La = '~memo', Nd = [];
function Dd(e) {
	return e !== null && typeof e === 'object';
}
function $a(e) {
	return e.map((t) => t.path ? { ...t, path: t.path.slice() } : { ...t });
}
var Md = new WeakMap(), dn = 0, Qi = 1, mn = 2;
function Xi(e, t, r) {
	let n = Md.get(e);
	if (n !== void 0) return n ? mn : dn;
	if (t.has(e)) return mn;
	t.add(e);
	let i = dn,
		o = (l) => {
			if (i !== mn && l?._zod) {
				let f = Xi(l, t, r);
				if (f > i) i = f;
			}
		},
		s = (l, f) => {
			let h = dn;
			for (let d of Reflect.ownKeys(l)) {
				let g = Object.getOwnPropertyDescriptor(l, d);
				if (f && !g.enumerable) continue;
				let y = g.get ? Qi : g.value?._zod ? Xi(g.value, t, r) : dn;
				if (y > h) h = y;
			}
			return h;
		},
		a = (l) => {
			if (l > i) i = l;
		},
		c = e._zod.def,
		u = c.type;
	switch (u) {
		case 'object': {
			let l = Pi(c);
			a(l ? s(l, !0) : Qi), o(c.catchall);
			break;
		}
		case 'array':
			o(c.element);
			break;
		case 'tuple':
			for (let l of c.items) o(l);
			o(c.rest);
			break;
		case 'record':
		case 'map':
			o(c.keyType), o(c.valueType);
			break;
		case 'set':
			o(c.valueType);
			break;
		case 'union':
			for (let l of c.options) o(l);
			break;
		case 'intersection':
			o(c.left), o(c.right);
			break;
		case 'optional':
		case 'nullable':
		case 'default':
		case 'prefault':
		case 'catch':
		case 'readonly':
		case 'nonoptional':
		case 'promise':
		case 'success':
			o(c.innerType);
			break;
		case 'pipe':
			o(c.in), o(c.out);
			break;
		case 'function':
			o(c.input), o(c.output);
			break;
		case 'lazy': {
			let l = c._cachedInner ?? (r ? e._zod.innerType : void 0);
			a(l ? Xi(l, t, !1) : Qi);
			break;
		}
		case 'template_literal':
		case 'string':
		case 'number':
		case 'int':
		case 'boolean':
		case 'bigint':
		case 'symbol':
		case 'undefined':
		case 'null':
		case 'void':
		case 'never':
		case 'any':
		case 'unknown':
		case 'date':
		case 'nan':
		case 'enum':
		case 'literal':
		case 'file':
		case 'transform':
		case 'custom':
			break;
		default:
			for (let l in c) {
				let f = Object.getOwnPropertyDescriptor(c, l);
				if (!f || f.get) continue;
				let h = f.value;
				if (!h || typeof h !== 'object') continue;
				if (h._zod) o(h);
				else if (Array.isArray(h)) { for (let d of h) o(d); }
			}
	}
	return t.delete(e), Nz(e, i);
}
function Nz(e, t) {
	if (t !== Qi) Md.set(e, t === mn);
	return t;
}
function qz(e, t) {
	let r = e.buckets.get(t);
	if (!r) r = new WeakMap(), e.buckets.set(t, r);
	return r;
}
var Wi,
	Yi = [],
	Dz = {
		alloc(e, t, r) {
			let n = Wi;
			if (!n) return r;
			Wi = void 0;
			let i = { value: r, issues: null };
			return n.set(t.value, i), Yi.push(i), r;
		},
		guard(e) {
			var t;
			(t = e._zod).deferred ?? (t.deferred = []),
				e._zod.deferred.push(() => {
					let r = e._zod.parse,
						n = (i, o) => {
							if (o.direction !== 'backward' && Mz(o, i.value)) throw new qd();
							return r(i, o);
						};
					if (e._zod.parse = n, e._zod.run === r) e._zod.run = n;
				});
		},
		attach(e) {
			var t;
			let r, n = !1, i, o;
			(t = e._zod).deferred ?? (t.deferred = []),
				e._zod.deferred.push(() => {
					let s = e._zod.parse,
						a = (c, u) => {
							if (r === void 0) {
								let k = Xi(e, new Set(), !1);
								if (k === dn) {
									if (e._zod.parse = s, e._zod.run === a) e._zod.run = s;
									return s(c, u);
								}
								if (k === mn || n) r = !0;
								else n = !0;
							}
							let l = c.value;
							if (!Dd(l)) return s(c, u);
							let f = u[La];
							if (!f) f = { buckets: new WeakMap(), backEdges: void 0 }, u[La] = f;
							let h;
							if (i === u) h = o;
							else h = qz(f, e), i = u, o = h;
							let d = h.get(l);
							if (d) {
								if (c.value = d.value, d.issues) { if (d.issues.length) c.issues.push(...$a(d.issues)); }
								else c.memo = !0, f.backEdges ?? (f.backEdges = new WeakSet()), f.backEdges.add(d.value);
								return c;
							}
							Wi = h;
							let g = Yi.length, y = s(c, u);
							Wi = void 0;
							let x = Yi.length > g ? Yi.pop() : void 0;
							if (y instanceof Promise) {
								return y.then((k) => {
									if (x) x.issues = k.issues.length ? $a(k.issues) : Nd;
									return k;
								});
							}
							if (x) x.issues = y.issues.length ? $a(y.issues) : Nd;
							return y;
						};
					if (e._zod.parse = a, e._zod.run === s) e._zod.run = a;
				});
		},
	};
function Fd() {
	return Dz;
}
function Mz(e, t) {
	let r = e[La]?.backEdges;
	return r !== void 0 && Dd(t) && r.has(t);
}
var Fz = () => {
	let e = {
		string: { unit: 'characters', verb: 'to have' },
		file: { unit: 'bytes', verb: 'to have' },
		array: { unit: 'items', verb: 'to have' },
		set: { unit: 'items', verb: 'to have' },
		map: { unit: 'entries', verb: 'to have' },
	};
	function t(o) {
		return e[o] ?? null;
	}
	let r = {
			regex: 'input',
			email: 'email address',
			url: 'URL',
			emoji: 'emoji',
			uuid: 'UUID',
			uuidv4: 'UUIDv4',
			uuidv6: 'UUIDv6',
			nanoid: 'nanoid',
			guid: 'GUID',
			cuid: 'cuid',
			cuid2: 'cuid2',
			ulid: 'ULID',
			xid: 'XID',
			ksuid: 'KSUID',
			datetime: 'ISO datetime',
			date: 'ISO date',
			time: 'ISO time',
			duration: 'ISO duration',
			ipv4: 'IPv4 address',
			ipv6: 'IPv6 address',
			mac: 'MAC address',
			cidrv4: 'IPv4 range',
			cidrv6: 'IPv6 range',
			base64: 'base64-encoded string',
			base64url: 'base64url-encoded string',
			json_string: 'JSON string',
			e164: 'E.164 number',
			currency_code: 'currency code',
			credit_card: 'credit card number',
			iban: 'IBAN',
			jwt: 'JWT',
			template_literal: 'input',
		},
		n = { nan: 'NaN' };
	function i(o, s) {
		if (o === 'number' && typeof s === 'number' && !Number.isFinite(s)) return String(s);
		return n[o] ?? o;
	}
	return (o) => {
		switch (o.code) {
			case 'invalid_type': {
				let s = i(o.expected), a = _p(o.input), c = i(a, o.input);
				return `Invalid input: expected ${s}, received ${c}`;
			}
			case 'invalid_value':
				if (o.values.length === 1) return `Invalid input: expected ${ha(o.values[0])}`;
				return `Invalid option: expected one of ${la(o.values, '|')}`;
			case 'too_big': {
				let s = o.exact ? 'exactly ' : o.inclusive ? '<=' : '<', a = t(o.origin);
				if (a) {
					return `Too big: expected ${o.origin ?? 'value'} to have ${s}${o.maximum.toString()} ${a.unit ?? 'elements'}`;
				}
				return `Too big: expected ${o.origin ?? 'value'} to be ${s}${o.maximum.toString()}`;
			}
			case 'too_small': {
				let s = o.exact ? 'exactly ' : o.inclusive ? '>=' : '>', a = t(o.origin);
				if (a) return `Too small: expected ${o.origin} to have ${s}${o.minimum.toString()} ${a.unit}`;
				return `Too small: expected ${o.origin} to be ${s}${o.minimum.toString()}`;
			}
			case 'invalid_format': {
				let s = o;
				if (s.format === 'starts_with') return `Invalid string: must start with "${s.prefix}"`;
				if (s.format === 'ends_with') return `Invalid string: must end with "${s.suffix}"`;
				if (s.format === 'includes') return `Invalid string: must include "${s.includes}"`;
				if (s.format === 'regex') return `Invalid string: must match pattern ${s.pattern}`;
				return `Invalid ${r[s.format] ?? o.format}`;
			}
			case 'not_multiple_of':
				return `Invalid number: must be a multiple of ${o.divisor}`;
			case 'unrecognized_keys':
				return `Unrecognized key${o.keys.length > 1 ? 's' : ''}: ${la(o.keys, ', ')}`;
			case 'invalid_key':
				return `Invalid key in ${o.origin}`;
			case 'invalid_union':
				if (o.options && Array.isArray(o.options) && o.options.length > 0) {
					return `Invalid discriminator value. Expected ${o.options.map((a) => `'${a}'`).join(' | ')}`;
				}
				if (o.inclusive === !1) return 'Invalid input: more than one option matched';
				return 'Invalid input';
			case 'invalid_element':
				return `Invalid value in ${o.origin}`;
			default:
				return 'Invalid input';
		}
	};
};
function Na() {
	return { localeError: Fz() };
}
var Rd;
class Bd {
	constructor() {
		this._map = new WeakMap(), this._idmap = new Map();
	}
	add(e, ...t) {
		let r = t[0];
		if (this._map.set(e, r), r && typeof r === 'object' && 'id' in r) this._idmap.set(r.id, e);
		return this;
	}
	clear() {
		return this._map = new WeakMap(), this._idmap = new Map(), this;
	}
	remove(e) {
		let t = this._map.get(e);
		if (t && typeof t === 'object' && 'id' in t) this._idmap.delete(t.id);
		return this._map.delete(e), this;
	}
	get(e) {
		let t = e._zod.parent;
		if (t) {
			let r = { ...this.get(t) ?? {} };
			delete r.id;
			let n = { ...r, ...this._map.get(e) };
			return Object.keys(n).length ? n : void 0;
		}
		return this._map.get(e);
	}
	has(e) {
		return this._map.has(e);
	}
}
function Rz() {
	return new Bd();
}
(Rd = globalThis).__zod_globalRegistry ?? (Rd.__zod_globalRegistry = Rz());
var jt = globalThis.__zod_globalRegistry;
function Bz(e) {
	if (e.checks) e.checks = [...e.checks];
	return e;
}
function Zd(e, t) {
	return new e(Bz({ type: 'string', ...B(t) }));
}
function jd(e, t) {
	return new e({ type: 'string', format: 'email', check: 'string_format', abort: !1, ...B(t) });
}
function Ud(e, t) {
	return new e({ type: 'string', format: 'guid', check: 'string_format', abort: !1, ...B(t) });
}
function Vd(e, t) {
	return new e({ type: 'string', format: 'uuid', check: 'string_format', abort: !1, ...B(t) });
}
function Kd(e, t) {
	return new e({ type: 'string', format: 'uuid', check: 'string_format', abort: !1, version: 'v4', ...B(t) });
}
function Jd(e, t) {
	return new e({ type: 'string', format: 'uuid', check: 'string_format', abort: !1, version: 'v6', ...B(t) });
}
function Hd(e, t) {
	return new e({ type: 'string', format: 'uuid', check: 'string_format', abort: !1, version: 'v7', ...B(t) });
}
function Gd(e, t) {
	return new e({ type: 'string', format: 'url', check: 'string_format', abort: !1, ...B(t) });
}
function Wd(e, t) {
	return new e({ type: 'string', format: 'emoji', check: 'string_format', abort: !1, ...B(t) });
}
function Yd(e, t) {
	return new e({ type: 'string', format: 'nanoid', check: 'string_format', abort: !1, ...B(t) });
}
function Qd(e, t) {
	return new e({ type: 'string', format: 'cuid', check: 'string_format', abort: !1, ...B(t) });
}
function Xd(e, t) {
	return new e({ type: 'string', format: 'cuid2', check: 'string_format', abort: !1, ...B(t) });
}
function em(e, t) {
	return new e({ type: 'string', format: 'ulid', check: 'string_format', abort: !1, ...B(t) });
}
function tm(e, t) {
	return new e({ type: 'string', format: 'xid', check: 'string_format', abort: !1, ...B(t) });
}
function rm(e, t) {
	return new e({ type: 'string', format: 'ksuid', check: 'string_format', abort: !1, ...B(t) });
}
function nm(e, t) {
	return new e({ type: 'string', format: 'ipv4', check: 'string_format', abort: !1, ...B(t) });
}
function im(e, t) {
	return new e({ type: 'string', format: 'ipv6', check: 'string_format', abort: !1, ...B(t) });
}
function om(e, t) {
	return new e({ type: 'string', format: 'cidrv4', check: 'string_format', abort: !1, ...B(t) });
}
function sm(e, t) {
	return new e({ type: 'string', format: 'cidrv6', check: 'string_format', abort: !1, ...B(t) });
}
function am(e, t) {
	return new e({ type: 'string', format: 'base64', check: 'string_format', abort: !1, ...B(t) });
}
function cm(e, t) {
	return new e({ type: 'string', format: 'base64url', check: 'string_format', abort: !1, ...B(t) });
}
function um(e, t) {
	return new e({ type: 'string', format: 'e164', check: 'string_format', abort: !1, ...B(t) });
}
function lm(e, t) {
	return new e({ type: 'string', format: 'jwt', check: 'string_format', abort: !1, ...B(t) });
}
function qa(e, t) {
	return new e({
		type: 'string',
		format: 'datetime',
		check: 'string_format',
		offset: !1,
		local: !1,
		precision: null,
		...B(t),
	});
}
function eo(e, t) {
	return new e({ type: 'string', format: 'date', check: 'string_format', ...B(t) });
}
function Da(e, t) {
	return new e({ type: 'string', format: 'time', check: 'string_format', precision: null, ...B(t) });
}
function Ma(e, t) {
	return new e({ type: 'string', format: 'duration', check: 'string_format', ...B(t) });
}
function fm(e, t) {
	return new e({ type: 'number', check: 'number_format', abort: !1, format: 'safeint', ...B(t) });
}
function pm(e) {
	return new e({ type: 'unknown' });
}
function hm(e, t) {
	return new e({ type: 'never', ...B(t) });
}
function to(e, t) {
	return new Ca({ check: 'less_than', ...B(t), value: e, inclusive: !1 });
}
function gn(e, t) {
	return new Ca({ check: 'less_than', ...B(t), value: e, inclusive: !0 });
}
function ro(e, t) {
	return new za({ check: 'greater_than', ...B(t), value: e, inclusive: !1 });
}
function yn(e, t) {
	return new za({ check: 'greater_than', ...B(t), value: e, inclusive: !0 });
}
function no(e, t) {
	return new gh({ check: 'multiple_of', ...B(t), value: e });
}
function io(e, t) {
	return new bh({ check: 'max_length', ...B(t), maximum: e });
}
function kr(e, t) {
	return new xh({ check: 'min_length', ...B(t), minimum: e });
}
function oo(e, t) {
	return new kh({ check: 'length_equals', ...B(t), length: e });
}
function Fa(e, t) {
	return new wh({ check: 'string_format', format: 'regex', ...B(t), pattern: e });
}
function Ra(e) {
	return new Sh({ check: 'string_format', format: 'lowercase', ...B(e) });
}
function Ba(e) {
	return new vh({ check: 'string_format', format: 'uppercase', ...B(e) });
}
function Za(e, t) {
	return new _h({ check: 'string_format', format: 'includes', ...B(t), includes: e });
}
function ja(e, t) {
	return new Ch({ check: 'string_format', format: 'starts_with', ...B(t), prefix: e });
}
function Ua(e, t) {
	return new zh({ check: 'string_format', format: 'ends_with', ...B(t), suffix: e });
}
function vt(e) {
	return new Th({ check: 'overwrite', tx: e });
}
function Va(e) {
	return vt((t) => t.normalize(e));
}
function Ka() {
	return vt((e) => e.trim());
}
function Ja() {
	return vt((e) => e.toLowerCase());
}
function Ha() {
	return vt((e) => e.toUpperCase());
}
function Ga() {
	return vt((e) => yp(e));
}
function dm(e, t, r) {
	return new e({ type: 'array', element: t, ...B(r) });
}
function mm(e, t, r) {
	return new e({ type: 'custom', check: 'custom', fn: t, ...B(r) });
}
function gm(e, t) {
	let r = Zz((n) => (n.addIssue = (i) => {
		if (typeof i === 'string') n.issues.push(Zt(i, n.value, r._zod.def));
		else {
			let o = i;
			if (o.fatal) o.continue = !1;
			if (o.code ?? (o.code = 'custom'), !('input' in o)) o.input = n.value;
			o.inst ?? (o.inst = r), o.continue ?? (o.continue = !r._zod.def.abort), n.issues.push(Zt(o));
		}
	},
		e(n.value, n)), t);
	return r;
}
function Zz(e, t) {
	let r = new de({ check: 'custom', ...B(t) });
	return r._zod.check = e, r;
}
function bn(e, ...t) {
	for (let r of t) {
		for (let n of Reflect.ownKeys(r)) if (Object.prototype.propertyIsEnumerable.call(r, n)) He(e, n, r[n]);
	}
	return e;
}
function Ya(e) {
	let t = e?.target ?? 'draft-2020-12';
	if (t === 'draft-4') t = 'draft-04';
	if (t === 'draft-7') t = 'draft-07';
	return {
		processors: e.processors ?? {},
		metadataRegistry: e?.metadata ?? jt,
		target: t,
		unrepresentable: e?.unrepresentable ?? 'throw',
		override: e?.override ?? (() => {}),
		io: e?.io ?? 'output',
		counter: 0,
		seen: new Map(),
		sharedDefsExtractedFor: void 0,
		sharedEmitDoneFor: void 0,
		cycles: e?.cycles ?? 'ref',
		reused: e?.reused ?? 'inline',
		intersections: [],
		deferred: [],
		external: e?.external ?? void 0,
	};
}
function ct(e, t, r, n, i) {
	let o = typeof t.unrepresentable === 'function'
		? t.unrepresentable({ zodSchema: e, path: n.path, message: i })
		: t.unrepresentable;
	if (o === 'any') return !1;
	if (o === void 0 || o === 'throw') throw Error(i);
	return Object.assign(r, o), !0;
}
function pe(e, t, r = { path: [], schemaPath: [] }) {
	var n;
	let i = e._zod.def, o = t.seen.get(e);
	if (o) {
		if (o.count++, r.schemaPath.includes(e)) o.cycle = r.path;
		return o.schema;
	}
	let s = { schema: {}, count: 1, cycle: void 0, path: r.path };
	t.seen.set(e, s), t.sharedDefsExtractedFor = void 0, t.sharedEmitDoneFor = void 0;
	let a = e._zod.toJSONSchema?.();
	if (a) s.schema = a;
	else {
		let l = { ...r, schemaPath: [...r.schemaPath, e], path: r.path };
		if (e._zod.processJSONSchema) e._zod.processJSONSchema(t, s.schema, l);
		else {
			let h = s.schema, d = t.processors[i.type];
			if (!d) throw Error(`[toJSONSchema]: Non-representable type encountered: ${i.type}`);
			d(e, t, h, l);
		}
		let f = e._zod.parent;
		if (f) {
			if (!s.ref) s.ref = f;
			pe(f, t, l), t.seen.get(f).isParent = !0;
		}
	}
	let c = t.metadataRegistry.get(e);
	if (c) bn(s.schema, c);
	if (t.io === 'input' && ke(e)) delete s.schema.examples, delete s.schema.default;
	if (t.io === 'input' && '_prefault' in s.schema) (n = s.schema).default ?? (n.default = s.schema._prefault);
	return delete s.schema._prefault, t.seen.get(e).schema;
}
function ym(e) {
	return e.replace(/~/g, '~0').replace(/\//g, '~1');
}
function Qa(e, t) {
	let r = e.seen.get(t);
	if (!r) throw Error('Unprocessed schema. This is a bug in Zod.');
	if (e.external && e.sharedDefsExtractedFor === e.external) return;
	let n = new Map();
	for (let s of e.seen.entries()) {
		let a = e.metadataRegistry.get(s[0])?.id;
		if (a) {
			let c = n.get(a);
			if (c && c !== s[0]) {
				throw Error(
					`Duplicate schema id "${a}" detected during JSON Schema conversion. Two different schemas cannot share the same id when converted together.`,
				);
			}
			n.set(a, s[0]);
		}
	}
	let i = (s) => {
			let a = e.target === 'draft-2020-12' ? '$defs' : 'definitions';
			if (e.external) {
				let f = e.external.registry.get(s[0])?.id, h = e.external.uri ?? ((g) => g);
				if (f) return { ref: h(f) };
				let d = s[1].defId ?? s[1].schema.id ?? `schema${e.counter++}`;
				return s[1].defId = d, { defId: d, ref: `${h('__shared')}#/${a}/${ym(d)}` };
			}
			let c = '#', u = `${c}/${a}/`;
			if (s[1] === r && !s[1].schema.id) return { ref: c };
			let l = s[1].schema.id ?? `__schema${e.counter++}`;
			return { defId: l, ref: u + ym(l) };
		},
		o = (s) => {
			if (s[1].schema.$ref) return;
			let a = s[1], { ref: c, defId: u } = i(s);
			if (a.def = { ...a.schema }, u) a.defId = u;
			let l = a.schema;
			for (let f in l) delete l[f];
			l.$ref = c;
		};
	if (e.cycles === 'throw') {
		for (let s of e.seen.entries()) {
			let a = s[1];
			if (a.cycle) {
				throw Error(`Cycle detected: #/${a.cycle?.join('/')}/<root>

Set the \`cycles\` parameter to \`"ref"\` to resolve cyclical schemas with defs.`);
			}
		}
	}
	for (let s of e.seen.entries()) {
		let a = s[1];
		if (t === s[0]) {
			o(s);
			continue;
		}
		if (e.external) {
			let u = e.external.registry.get(s[0])?.id;
			if (t !== s[0] && u) {
				o(s);
				continue;
			}
		}
		if (e.metadataRegistry.get(s[0])?.id) {
			o(s);
			continue;
		}
		if (a.cycle) {
			o(s);
			continue;
		}
		if (a.count > 1) { if (e.reused === 'ref') o(s); }
	}
	if (e.external) e.sharedDefsExtractedFor = e.external;
}
function km(e) {
	let t = e.anyOf;
	if (!Array.isArray(t) || t.length === 0 || e.type !== void 0) return;
	let r = [];
	for (let n of t) {
		if (!n || typeof n !== 'object') return;
		km(n);
		let i = Object.keys(n);
		if (i.length !== 1 || i[0] !== 'type') return;
		let o = n.type;
		for (let s of Array.isArray(o) ? o : [o]) {
			if (typeof s !== 'string') return;
			if (!r.includes(s)) r.push(s);
		}
	}
	delete e.anyOf, e.type = r.length === 1 ? r[0] : r;
}
var wm = new Set(['type', 'properties', 'required', 'additionalProperties']), bm = ['oneOf', 'anyOf'];
function xm(e) {
	let t = e.additionalProperties;
	if (t === void 0 || t === !1 || typeof t !== 'object' || t === null) return null;
	return Object.keys(t).length ? t : null;
}
function Wa(e) {
	let t = [];
	for (let o of e) {
		if (typeof o !== 'object' || o.type !== 'object') return null;
		for (let s in o) if (!wm.has(s)) return null;
		t.push(o);
	}
	let r = {}, n = new Set();
	for (let o of t) {
		for (let s in o.properties) {
			if (Object.prototype.hasOwnProperty.call(r, s)) continue;
			let a = [];
			for (let u of t) {
				let l = u.properties?.[s] ?? xm(u);
				if (l === null || l === void 0) continue;
				if (!a.some((f) => JSON.stringify(f) === JSON.stringify(l))) a.push(l);
			}
			let c = a.length === 1 ? a[0] : Wa(a) ?? { allOf: a };
			He(r, s, c);
		}
		for (let s of o.required ?? []) n.add(s);
	}
	let i = { type: 'object', properties: r };
	if (n.size) i.required = [...n];
	if (t.every((o) => o.additionalProperties === !1)) i.additionalProperties = !1;
	else {
		let o = [];
		for (let s of t) {
			let a = xm(s);
			if (a && !o.some((c) => JSON.stringify(c) === JSON.stringify(a))) o.push(a);
		}
		if (o.length === 1) i.additionalProperties = o[0];
		else if (o.length > 1) i.additionalProperties = { allOf: o };
	}
	return i;
}
function jz(e) {
	let t = e.allOf;
	if (!Array.isArray(t) || t.length < 2) return;
	for (let i of wm) if (i in e) return;
	let r = t.filter((i) => bm.some((o) => Array.isArray(i[o]))), n = null;
	if (!r.length) n = Wa(t);
	else {
		let i = r[0], o = bm.find((c) => Array.isArray(i[c]));
		if (Object.keys(i).length !== 1) return;
		let s = t.filter((c) => c !== i), a = i[o].map((c) => Wa([...s, c]));
		if (a.some((c) => !c)) return;
		n = { [o]: a };
	}
	if (!n) return;
	delete e.allOf, bn(e, n);
}
function Xa(e, t) {
	let r = e.seen.get(t);
	if (!r) throw Error('Unprocessed schema. This is a bug in Zod.');
	let n = (a) => {
		let c = e.seen.get(a);
		if (c.ref === null) return;
		let u = c.def ?? c.schema, l = { ...u }, f = c.ref;
		if (c.ref = null, f) {
			n(f);
			let d = e.seen.get(f), g = d.schema;
			if (g.$ref && (e.target === 'draft-07' || e.target === 'draft-04' || e.target === 'openapi-3.0')) {
				u.allOf = u.allOf ?? [], u.allOf.push(g);
			} else bn(u, g);
			if (bn(u, l), a._zod.parent === f) {
				for (let x in u) {
					if (x === '$ref' || x === 'allOf') continue;
					if (!(x in l)) delete u[x];
				}
			}
			if (g.$ref && d.def) {
				for (let x in u) {
					if (x === '$ref' || x === 'allOf') continue;
					if (x in d.def && JSON.stringify(u[x]) === JSON.stringify(d.def[x])) delete u[x];
				}
			}
		}
		let h = a._zod.parent;
		if (h && h !== f) {
			n(h);
			let d = e.seen.get(h);
			if (d?.schema.$ref) {
				if (u.$ref = d.schema.$ref, d.def) {
					for (let g in u) {
						if (g === '$ref' || g === 'allOf') continue;
						if (g in d.def && JSON.stringify(u[g]) === JSON.stringify(d.def[g])) delete u[g];
					}
				}
			}
		}
		e.override({ zodSchema: a, jsonSchema: u, path: c.path ?? [] });
	};
	if (!e.external || e.sharedEmitDoneFor !== e.external) {
		for (let a of [...e.seen.entries()].reverse()) n(a[0]);
		if (e.target !== 'openapi-3.0') { for (let a of e.seen.entries()) km(a[1].def ?? a[1].schema); }
		for (let a of e.deferred) a();
		if (e.intersections.length) {
			let a = new Map();
			for (let c of e.seen.values()) {
				for (let u of [c.schema, c.def]) {
					let l = u?.allOf;
					if (!Array.isArray(l)) continue;
					let f = a.get(l);
					if (f) f.push(u);
					else a.set(l, [u]);
				}
			}
			for (let c of e.intersections) for (let u of a.get(c) ?? []) jz(u);
		}
	}
	let i = {};
	if (e.target === 'draft-2020-12') i.$schema = 'https://json-schema.org/draft/2020-12/schema';
	else if (e.target === 'draft-07') i.$schema = 'http://json-schema.org/draft-07/schema#';
	else if (e.target === 'draft-04') i.$schema = 'http://json-schema.org/draft-04/schema#';
	else if (e.target === 'openapi-3.0');
	if (e.external?.uri) {
		let a = e.external.registry.get(t)?.id;
		if (!a) throw Error('Schema is missing an `id` property');
		i.$id = e.external.uri(a);
	}
	bn(i, r.defId ? r.schema : r.def ?? r.schema);
	let o = e.metadataRegistry.get(t)?.id;
	if (o !== void 0 && i.id === o) delete i.id;
	let s = e.external?.defs ?? {};
	if (!e.external || e.sharedEmitDoneFor !== e.external) {
		for (let a of e.seen.entries()) {
			let c = a[1];
			if (c.def && c.defId) {
				if (c.def.id === c.defId) delete c.def.id;
				He(s, c.defId, c.def);
			}
		}
	}
	if (e.external) e.sharedEmitDoneFor = e.external;
	if (e.external);
	else if (Object.keys(s).length > 0) {
		if (e.target === 'draft-2020-12') i.$defs = s;
		else i.definitions = s;
	}
	try {
		let a = JSON.parse(JSON.stringify(i));
		return Object.defineProperty(a, '~standard', {
			value: {
				...t['~standard'],
				jsonSchema: { input: xn(t, 'input', e.processors), output: xn(t, 'output', e.processors) },
			},
			enumerable: !1,
			writable: !1,
		}),
			a;
	} catch (a) {
		throw Error('Error converting schema to JSON.');
	}
}
function ke(e, t) {
	let r = t ?? { seen: new Set() };
	if (r.seen.has(e)) return !1;
	r.seen.add(e);
	let n = e._zod.def;
	if (n.type === 'transform') return !0;
	if (n.type === 'array') return ke(n.element, r);
	if (n.type === 'set') return ke(n.valueType, r);
	if (n.type === 'lazy') return ke(n.getter(), r);
	if (
		n.type === 'promise' || n.type === 'optional' || n.type === 'nonoptional' || n.type === 'nullable'
		|| n.type === 'readonly' || n.type === 'default' || n.type === 'prefault' || n.type === 'catch'
	) return ke(n.innerType, r);
	if (n.type === 'intersection') return ke(n.left, r) || ke(n.right, r);
	if (n.type === 'record' || n.type === 'map') return ke(n.keyType, r) || ke(n.valueType, r);
	if (n.type === 'pipe') {
		if (e._zod.traits.has('$ZodCodec')) return !0;
		return ke(n.in, r) || ke(n.out, r);
	}
	if (n.type === 'object') {
		for (let i in n.shape) if (ke(n.shape[i], r)) return !0;
		return !1;
	}
	if (n.type === 'union') {
		for (let i of n.options) if (ke(i, r)) return !0;
		return !1;
	}
	if (n.type === 'tuple') {
		for (let i of n.items) if (ke(i, r)) return !0;
		if (n.rest && ke(n.rest, r)) return !0;
		return !1;
	}
	return !1;
}
var Sm = (e, t = {}) => (r) => {
		let n = Ya({ ...r, processors: t });
		return pe(e, n), Qa(n, e), Xa(n, e);
	},
	xn = (e, t, r = {}) => (n) => {
		let { libraryOptions: i, target: o } = n ?? {}, s = Ya({ ...i ?? {}, target: o, io: t, processors: r });
		return pe(e, s), Qa(s, e), Xa(s, e);
	};
var wr = (e, t, r) => {
		if (e[t] === void 0 || r > e[t]) e[t] = r;
	},
	Sr = (e, t, r) => {
		if (e[t] === void 0 || r < e[t]) e[t] = r;
	},
	vm = (e, t) => {
		wr(e, 'minimum', t), Sr(e, 'maximum', t);
	},
	Tm = (e, t) => {
		if (e.multipleOf ?? (e.multipleOf = []), !e.multipleOf.includes(t)) e.multipleOf.push(t);
	},
	Am = (e, t) => {
		e.patterns ?? (e.patterns = new Set()), e.patterns.add(t);
	},
	Em = (e, t) => {
		e.mime = e.mime ? e.mime.filter((r) => t.includes(r)) : [...t];
	},
	Im = (e, t) => {
		if (e.format = t, t.includes('int')) e.isInt = !0;
	},
	_m = (e, t) => wr(e, 'minimum', t.minimum),
	Cm = (e, t) => Sr(e, 'maximum', t.maximum),
	zm = (e) => (t, r) => {
		Im(t, r.format);
		let [n, i] = e[r.format];
		wr(t, 'minimum', n), Sr(t, 'maximum', i);
	},
	Uz = {
		greater_than: (e, t) => wr(e, t.inclusive ? 'minimum' : 'exclusiveMinimum', t.value),
		less_than: (e, t) => Sr(e, t.inclusive ? 'maximum' : 'exclusiveMaximum', t.value),
		multiple_of: (e, t) => Tm(e, t.value),
		number_format: zm(Oi),
		bigint_format: zm(da),
		min_length: _m,
		max_length: Cm,
		length_equals: (e, t) => vm(e, t.length),
		min_size: _m,
		max_size: Cm,
		size_equals: (e, t) => vm(e, t.size),
		string_format: (e, t) => {
			if (Im(e, t.format), t.pattern) Am(e, t.pattern);
			if (t.format === 'base64' || t.format === 'base64url') e.contentEncoding = t.format;
			if (t.local || t.precision === -1) e.laxFormat = !0;
		},
		mime_type: (e, t) => Em(e, t.mime),
	};
function Be(e) {
	let t = {}, r = e._zod.def, n = e._zod.traits.has('$ZodCheck') ? [e, ...r.checks ?? []] : r.checks ?? [];
	for (let o of n) Uz[o._zod.def.check]?.(t, o._zod.def);
	let i = e._zod.bag;
	if (i.minimum !== void 0) wr(t, 'minimum', i.minimum);
	if (i.exclusiveMinimum !== void 0) wr(t, 'exclusiveMinimum', i.exclusiveMinimum);
	if (i.maximum !== void 0) Sr(t, 'maximum', i.maximum);
	if (i.exclusiveMaximum !== void 0) Sr(t, 'exclusiveMaximum', i.exclusiveMaximum);
	if (i.multipleOf !== void 0) Tm(t, i.multipleOf);
	if (i.format !== void 0) { if (t.format ?? (t.format = i.format), i.format.includes('int')) t.isInt = !0; }
	if (i.mime) Em(t, i.mime);
	for (let o of i.patterns ?? []) Am(t, o);
	return t;
}
var Vz = { guid: 'uuid', url: 'uri', datetime: 'date-time', json_string: 'json-string', regex: '' },
	Kz = new Map([[Ia, oh], [Gi, sh]]),
	Jz = (e) => Kz.get(e) ?? e,
	Pm = (e, t, r, n) => {
		let i = r;
		i.type = 'string';
		let { minimum: o, maximum: s, format: a, patterns: c, contentEncoding: u, laxFormat: l } = Be(e);
		if (typeof o === 'number') i.minLength = o;
		if (typeof s === 'number') i.maxLength = s;
		if (a) {
			if (i.format = Vz[a] ?? a, i.format === '') delete i.format;
			if (a === 'time' || l) delete i.format;
		}
		if (u) i.contentEncoding = u;
		if (c && c.size > 0) {
			let f = [...c].map(Jz);
			if (f.length === 1) i.pattern = f[0].source;
			else if (f.length > 1) {
				i.allOf = [
					...f.map((h) => ({
						...t.target === 'draft-07' || t.target === 'draft-04' || t.target === 'openapi-3.0'
							? { type: 'string' }
							: {},
						pattern: h.source,
					})),
				];
			}
		}
	},
	Om = (e, t, r, n) => {
		let i = r, { minimum: o, maximum: s, multipleOf: a, exclusiveMaximum: c, exclusiveMinimum: u, isInt: l } = Be(e);
		i.type = l ? 'integer' : 'number';
		let f = typeof u === 'number' && u >= (o ?? Number.NEGATIVE_INFINITY),
			h = typeof c === 'number' && c <= (s ?? Number.POSITIVE_INFINITY),
			d = t.target === 'draft-04' || t.target === 'openapi-3.0';
		if (f) {
			if (d) i.minimum = u, i.exclusiveMinimum = !0;
			else i.exclusiveMinimum = u;
		} else if (typeof o === 'number') i.minimum = o;
		if (h) {
			if (d) i.maximum = c, i.exclusiveMaximum = !0;
			else i.exclusiveMaximum = c;
		} else if (typeof s === 'number') i.maximum = s;
		if (a) {
			let g = new Set();
			for (let k of a) {
				if (Number.isFinite(k) && k !== 0) g.add(Math.abs(k));
				else ct(e, t, i, n, `A multipleOf divisor of ${k} cannot be represented in JSON Schema`);
			}
			let [y, ...x] = g;
			if (y !== void 0) i.multipleOf = y;
			if (x.length) i.allOf = [...i.allOf ?? [], ...x.map((k) => ({ multipleOf: k }))];
		}
	};
var $m = (e, t, r, n) => {
	r.not = {};
};
var Lm = (e, t, r, n) => {};
var Nm = (e, t, r, n) => {
		let i = e._zod.def, o = un(i.entries);
		if (o.length === 0) {
			r.not = {};
			return;
		}
		if (o.every((s) => typeof s === 'number')) r.type = 'number';
		if (o.every((s) => typeof s === 'string')) r.type = 'string';
		r.enum = o;
	},
	qm = (e, t, r, n) => {
		let i = e._zod.def;
		if (i.values.length === 0) {
			r.not = {};
			return;
		}
		let o = [];
		for (let s of i.values) {
			if (s === void 0) { if (ct(e, t, r, n, 'Literal `undefined` cannot be represented in JSON Schema')) return; }
			else if (typeof s === 'bigint') {
				if (ct(e, t, r, n, 'BigInt literals cannot be represented in JSON Schema')) return;
				o.push(Number(s));
			} else o.push(s);
		}
		if (o.length === 0);
		else if (o.length === 1) {
			let s = o[0];
			if (r.type = s === null ? 'null' : typeof s, t.target === 'draft-04' || t.target === 'openapi-3.0') r.enum = [s];
			else r.const = s;
		} else {
			if (o.every((s) => typeof s === 'number')) r.type = 'number';
			if (o.every((s) => typeof s === 'string')) r.type = 'string';
			if (o.every((s) => typeof s === 'boolean')) r.type = 'boolean';
			if (o.every((s) => s === null)) r.type = 'null';
			r.enum = o;
		}
	};
var Dm = (e, t, r, n) => {
	ct(e, t, r, n, 'Custom types cannot be represented in JSON Schema');
};
var Mm = (e, t, r, n) => {
	ct(e, t, r, n, 'Transforms cannot be represented in JSON Schema');
};
var Fm = (e, t, r, n) => {
	let i = r, o = e._zod.def, { minimum: s, maximum: a } = Be(e);
	if (typeof s === 'number') i.minItems = s;
	if (typeof a === 'number') i.maxItems = a;
	i.type = 'array', i.items = pe(o.element, t, { ...n, path: [...n.path, 'items'] });
};
function ec(e) {
	let t = e._zod.def;
	if (t.type === 'pipe' && t.in._zod.traits.has('$ZodTransform')) return ec(t.out);
	if (t.type === 'catch') return ec(t.innerType);
	return e._zod.optin;
}
var Rm = (e, t, r, n) => {
		let i = r, o = e._zod.def, s = o.shape;
		if (Object.getOwnPropertySymbols(s).length && ct(e, t, i, n, 'Symbol keys cannot be represented in JSON Schema')) {
			return;
		}
		i.type = 'object', i.properties = {};
		for (let u in s) He(i.properties, u, pe(s[u], t, { ...n, path: [...n.path, 'properties', u] }));
		let c = [];
		for (let u of Object.keys(s)) {
			let l = o.shape[u];
			if (t.io === 'input' ? ec(l) === void 0 : l._zod.optout === void 0) c.push(u);
		}
		if (c.length > 0) i.required = c;
		if (o.catchall?._zod.def.type === 'never') i.additionalProperties = !1;
		else if (!o.catchall) { if (t.io === 'output') i.additionalProperties = !1; }
		else if (o.catchall) {
			i.additionalProperties = pe(o.catchall, t, { ...n, path: [...n.path, 'additionalProperties'] });
		}
	},
	Bm = (e, t, r, n) => {
		let i = e._zod.def,
			o = i.inclusive === !1,
			s = i.options.map((a, c) => pe(a, t, { ...n, path: [...n.path, o ? 'oneOf' : 'anyOf', c] }));
		if (o) r.oneOf = s;
		else r.anyOf = s;
	},
	Zm = (e, t, r, n) => {
		let i = e._zod.def,
			o = pe(i.left, t, { ...n, path: [...n.path, 'allOf', 0] }),
			s = pe(i.right, t, { ...n, path: [...n.path, 'allOf', 1] }),
			a = (u) => ('allOf' in u) && Object.keys(u).length === 1,
			c = [...a(o) ? o.allOf : [o], ...a(s) ? s.allOf : [s]];
		r.allOf = c, t.intersections.push(c);
	};
var jm = (e, t, r, n) => {
		let i = e._zod.def, o = pe(i.innerType, t, n), s = t.seen.get(e);
		if (t.target === 'openapi-3.0') s.ref = i.innerType, r.nullable = !0;
		else r.anyOf = [o, { type: 'null' }];
	},
	Um = (e, t, r, n) => {
		let i = e._zod.def;
		pe(i.innerType, t, n);
		let o = t.seen.get(e);
		o.ref = i.innerType;
	},
	tc = Symbol();
function Vm(e, t, r, n, i) {
	let o = !1,
		s = JSON.stringify(e, (a, c) => {
			if (typeof c !== 'bigint') return c;
			return o = !0, null;
		});
	if (!o) return JSON.parse(s);
	return ct(t, r, n, i, 'BigInt defaults cannot be represented in JSON Schema'), tc;
}
var Km = (e, t, r, n) => {
		let i = e._zod.def;
		pe(i.innerType, t, n);
		let o = t.seen.get(e);
		o.ref = i.innerType;
		let s = Vm(i.defaultValue, e, t, r, n);
		if (s !== tc) r.default = s;
	},
	Jm = (e, t, r, n) => {
		let i = e._zod.def;
		pe(i.innerType, t, n);
		let o = t.seen.get(e);
		if (o.ref = i.innerType, t.io !== 'input') return;
		let s = Vm(i.defaultValue, e, t, r, n);
		if (s !== tc) r._prefault = s;
	},
	Hm = (e, t, r, n) => {
		let i = e._zod.def;
		pe(i.innerType, t, n);
		let o = t.seen.get(e);
		o.ref = i.innerType;
		let s;
		try {
			s = i.catchValue(void 0);
		} catch {
			ct(e, t, r, n, 'Dynamic catch values are not supported in JSON Schema');
			return;
		}
		r.default = s;
	},
	Gm = (e, t, r, n) => {
		let i = e._zod.def, o = i.in._zod.traits.has('$ZodTransform'), s = t.io === 'input' ? o ? i.out : i.in : i.out;
		pe(s, t, n);
		let a = t.seen.get(e);
		a.ref = s;
	},
	Wm = (e, t, r, n) => {
		let i = e._zod.def;
		pe(i.innerType, t, n);
		let o = t.seen.get(e);
		o.ref = i.innerType, r.readOnly = !0;
	};
var rc = (e, t, r, n) => {
	let i = e._zod.def;
	pe(i.innerType, t, n);
	let o = t.seen.get(e);
	o.ref = i.innerType;
};
var Ym = new WeakSet([Object.prototype, Error.prototype]);
function so(e, t, r) {
	Object.defineProperty(e, t, {
		configurable: !0,
		enumerable: !1,
		get() {
			let n = r(this);
			return Object.defineProperty(this, t, { value: n, configurable: !0, writable: !0 }), n;
		},
		set(n) {
			Object.defineProperty(this, t, { value: n, configurable: !0, writable: !0 });
		},
	});
}
var rT = (e, t) => {
	Op.init(e, t), e.name = 'ZodError';
	let r = Object.getPrototypeOf(e);
	if (Ym.has(r)) return;
	Ym.add(r),
		so(r, 'format', (n) => (i) => Lp(n, i)),
		so(r, 'flatten', (n) => (i) => $p(n, i)),
		so(r, 'addIssue', (n) => (i) => {
			n.issues.push(i), n.message = JSON.stringify(n.issues, ln, 2);
		}),
		so(r, 'addIssues', (n) => (i) => {
			n.issues.push(...i), n.message = JSON.stringify(n.issues, ln, 2);
		}),
		Object.defineProperty(r, 'isEmpty', {
			configurable: !0,
			enumerable: !1,
			get() {
				return this.issues.length === 0;
			},
		});
};
var Ae = E('ZodError', rT, void 0, { Parent: Error });
var Qm = Ri(Ae),
	Xm = Bi(Ae),
	eg = Zi(Ae),
	tg = ji(Ae),
	rg = qp(Ae),
	ng = Dp(Ae),
	ig = Mp(Ae),
	og = Fp(Ae),
	sg = Rp(Ae),
	ag = Bp(Ae),
	cg = Zp(Ae),
	ug = jp(Ae);
function iT() {
	if (!Te.localeError) Re(Na());
}
function ic() {
	if (!Te.memoizer) Re({ memoizer: Fd() });
}
var se = E('ZodType', (e, t) => (iT(), ie.init(e, t), e.def = t, e.type = t.type, e), {
		check(...e) {
			let t = this.def;
			return this.clone(
				ze(t, {
					checks: [
						...t.checks ?? [],
						...e.map((r) =>
							typeof r === 'function' ? { _zod: { check: r, def: { check: 'custom' }, onattach: [] } } : r
						),
					],
				}),
				{ parent: !0 },
			);
		},
		with(...e) {
			return this.check(...e);
		},
		clone(e, t) {
			return Ge(this, e, t);
		},
		brand() {
			return this;
		},
		register(e, t) {
			return e.add(this, t), this;
		},
		refine(e, t) {
			return this.check(WT(e, t));
		},
		superRefine(e, t) {
			return this.check(YT(e, t));
		},
		overwrite(e) {
			return this.check(vt(e));
		},
		optional() {
			return fg(this);
		},
		exactOptional() {
			return DT(this);
		},
		nullable() {
			return pg(this);
		},
		nullish() {
			return fg(pg(this));
		},
		nonoptional(e) {
			return jT(this, e);
		},
		array() {
			return Le(this);
		},
		or(e) {
			return PT([this, e]);
		},
		and(e) {
			return $T(this, e);
		},
		transform(e) {
			return hg(this, qT(e));
		},
		default(e) {
			return RT(this, e);
		},
		prefault(e) {
			return ZT(this, e);
		},
		catch(e) {
			return VT(this, e);
		},
		pipe(e) {
			return hg(this, e);
		},
		readonly() {
			return HT(this);
		},
		describe(e) {
			let t = this.clone();
			return jt.add(t, { description: e }), t;
		},
		meta(...e) {
			if (e.length === 0) return jt.get(this);
			let t = this.clone();
			return jt.add(t, e[0]), t;
		},
		isOptional() {
			return this.safeParse(void 0).success;
		},
		isNullable() {
			return this.safeParse(null).success;
		},
		apply(e, ...t) {
			return t.length === 0 ? e(this) : e(this, ...t);
		},
		get '~standard'() {
			return Mi(this, '~standard', {
				...Ea(this),
				jsonSchema: { input: xn(this, 'input'), output: xn(this, 'output') },
			});
		},
		set '~standard'(e) {
			at(this, '~standard', e);
		},
		parse: function e(t, r) {
			return Qm(this, t, r, { callee: e });
		},
		parseAsync: async function e(t, r) {
			return await Xm(this, t, r, { callee: e });
		},
		safeParse(e, t) {
			return eg(this, e, t);
		},
		async safeParseAsync(e, t) {
			return tg(this, e, t);
		},
		get spa() {
			return this?.safeParseAsync;
		},
		set spa(e) {
			at(this, 'spa', e);
		},
		validate(e, t) {
			return xa(this, e, t);
		},
		validateAsync(e, t) {
			return ka(this, e, t);
		},
		encode: function e(t, r) {
			return rg(this, t, r, { callee: e });
		},
		decode: function e(t, r) {
			return ng(this, t, r, { callee: e });
		},
		encodeAsync: async function e(t, r) {
			return await ig(this, t, r, { callee: e });
		},
		decodeAsync: async function e(t, r) {
			return await og(this, t, r, { callee: e });
		},
		safeEncode(e, t) {
			return sg(this, e, t);
		},
		safeDecode(e, t) {
			return ag(this, e, t);
		},
		async safeEncodeAsync(e, t) {
			return cg(this, e, t);
		},
		async safeDecodeAsync(e, t) {
			return ug(this, e, t);
		},
		toJSONSchema(e) {
			return Sm(this, {})(e);
		},
		get description() {
			return jt.get(this)?.description;
		},
		get _def() {
			return this._zod.def;
		},
	}),
	dg = E(
		'_ZodString',
		(e, t) => {
			Hi.init(e, t), se.init(e, t), e._zod.processJSONSchema = (r, n, i) => Pm(e, r, n, i);
		},
		zp({
			format: (e) => Be(e).format ?? null,
			minLength: (e) => Be(e).minimum ?? null,
			maxLength: (e) => Be(e).maximum ?? null,
		}, {
			regex(...e) {
				return this.check(Fa(...e));
			},
			includes(...e) {
				return this.check(Za(...e));
			},
			startsWith(...e) {
				return this.check(ja(...e));
			},
			endsWith(...e) {
				return this.check(Ua(...e));
			},
			min(...e) {
				return this.check(kr(...e));
			},
			max(...e) {
				return this.check(io(...e));
			},
			length(...e) {
				return this.check(oo(...e));
			},
			nonempty(...e) {
				return this.check(kr(1, ...e));
			},
			lowercase(e) {
				return this.check(Ra(e));
			},
			uppercase(e) {
				return this.check(Ba(e));
			},
			trim() {
				return this.check(Ka());
			},
			normalize(...e) {
				return this.check(Va(...e));
			},
			toLowerCase() {
				return this.check(Ja());
			},
			toUpperCase() {
				return this.check(Ha());
			},
			slugify() {
				return this.check(Ga());
			},
		}),
	),
	oT = E('ZodString', (e, t) => {
		Hi.init(e, t), dg.init(e, t);
	}, {
		email(e) {
			return this.check(jd(sT, e));
		},
		url(e) {
			return this.check(Gd(cT, e));
		},
		jwt(e) {
			return this.check(lm(vT, e));
		},
		emoji(e) {
			return this.check(Wd(uT, e));
		},
		guid(e) {
			return this.check(Ud(aT, e));
		},
		uuid(e) {
			return this.check(Vd(ao, e));
		},
		uuidv4(e) {
			return this.check(Kd(ao, e));
		},
		uuidv6(e) {
			return this.check(Jd(ao, e));
		},
		uuidv7(e) {
			return this.check(Hd(ao, e));
		},
		nanoid(e) {
			return this.check(Yd(lT, e));
		},
		cuid(e) {
			return this.check(Qd(fT, e));
		},
		cuid2(e) {
			return this.check(Xd(pT, e));
		},
		ulid(e) {
			return this.check(em(hT, e));
		},
		base64(e) {
			return this.check(am(kT, e));
		},
		base64url(e) {
			return this.check(cm(wT, e));
		},
		xid(e) {
			return this.check(tm(dT, e));
		},
		ksuid(e) {
			return this.check(rm(mT, e));
		},
		ipv4(e) {
			return this.check(nm(gT, e));
		},
		ipv6(e) {
			return this.check(im(yT, e));
		},
		cidrv4(e) {
			return this.check(om(bT, e));
		},
		cidrv6(e) {
			return this.check(sm(xT, e));
		},
		e164(e) {
			return this.check(um(ST, e));
		},
		datetime(e) {
			return this.check(qa(mg, e));
		},
		date(e) {
			return this.check(eo(oc, e));
		},
		time(e) {
			return this.check(Da(gg, e));
		},
		duration(e) {
			return this.check(Ma(yg, e));
		},
	});
function Q(e) {
	return Zd(oT, e);
}
var re = E('ZodStringFormat', (e, t) => {
		ee.init(e, t), dg.init(e, t);
	}),
	mg = E('ZodISODateTime', (e, t) => {
		ed.init(e, t), re.init(e, t);
	}),
	oc = E('ZodISODate', (e, t) => {
		td.init(e, t), re.init(e, t);
	}),
	gg = E('ZodISOTime', (e, t) => {
		rd.init(e, t), re.init(e, t);
	}),
	yg = E('ZodISODuration', (e, t) => {
		nd.init(e, t), re.init(e, t);
	}),
	sT = E('ZodEmail', (e, t) => {
		jh.init(e, t), re.init(e, t);
	});
var aT = E('ZodGUID', (e, t) => {
	Bh.init(e, t), re.init(e, t);
});
var ao = E('ZodUUID', (e, t) => {
	Zh.init(e, t), re.init(e, t);
});
var cT = E('ZodURL', (e, t) => {
	Kh.init(e, t), re.init(e, t);
});
var uT = E('ZodEmoji', (e, t) => {
	Jh.init(e, t), re.init(e, t);
});
var lT = E('ZodNanoID', (e, t) => {
	Hh.init(e, t), re.init(e, t);
});
var fT = E('ZodCUID', (e, t) => {
	Gh.init(e, t), re.init(e, t);
});
var pT = E('ZodCUID2', (e, t) => {
	Wh.init(e, t), re.init(e, t);
});
var hT = E('ZodULID', (e, t) => {
	Yh.init(e, t), re.init(e, t);
});
var dT = E('ZodXID', (e, t) => {
	Qh.init(e, t), re.init(e, t);
});
var mT = E('ZodKSUID', (e, t) => {
	Xh.init(e, t), re.init(e, t);
});
var gT = E('ZodIPv4', (e, t) => {
	id.init(e, t), re.init(e, t);
});
var yT = E('ZodIPv6', (e, t) => {
	sd.init(e, t), re.init(e, t);
});
var bT = E('ZodCIDRv4', (e, t) => {
	ad.init(e, t), re.init(e, t);
});
var xT = E('ZodCIDRv6', (e, t) => {
	cd.init(e, t), re.init(e, t);
});
var kT = E('ZodBase64', (e, t) => {
	ld.init(e, t), re.init(e, t);
});
var wT = E('ZodBase64URL', (e, t) => {
	fd.init(e, t), re.init(e, t);
});
var ST = E('ZodE164', (e, t) => {
	pd.init(e, t), re.init(e, t);
});
var vT = E('ZodJWT', (e, t) => {
	hd.init(e, t), re.init(e, t);
});
var _T = E(
	'ZodNumber',
	(e, t) => {
		Pa.init(e, t), se.init(e, t), e._zod.processJSONSchema = (r, n, i) => Om(e, r, n, i), e.isFinite = !0;
	},
	zp({
		minValue: (e) => {
			let { minimum: t, exclusiveMinimum: r } = Be(e);
			return Math.max(t ?? Number.NEGATIVE_INFINITY, r ?? Number.NEGATIVE_INFINITY);
		},
		maxValue: (e) => {
			let { maximum: t, exclusiveMaximum: r } = Be(e);
			return Math.min(t ?? Number.POSITIVE_INFINITY, r ?? Number.POSITIVE_INFINITY);
		},
		isInt: (e) => {
			let { isInt: t, multipleOf: r } = Be(e);
			return !!t || !!r?.some(Number.isSafeInteger);
		},
		format: (e) => Be(e).format ?? null,
	}, {
		gt(e, t) {
			return this.check(ro(e, t));
		},
		gte(e, t) {
			return this.check(yn(e, t));
		},
		min(e, t) {
			return this.check(yn(e, t));
		},
		lt(e, t) {
			return this.check(to(e, t));
		},
		lte(e, t) {
			return this.check(gn(e, t));
		},
		max(e, t) {
			return this.check(gn(e, t));
		},
		int(e) {
			return this.check(co(e));
		},
		safe(e) {
			return this.check(co(e));
		},
		positive(e) {
			return this.check(ro(0, e));
		},
		nonnegative(e) {
			return this.check(yn(0, e));
		},
		negative(e) {
			return this.check(to(0, e));
		},
		nonpositive(e) {
			return this.check(gn(0, e));
		},
		multipleOf(e, t) {
			return this.check(no(e, t));
		},
		step(e, t) {
			return this.check(no(e, t));
		},
		finite() {
			return this;
		},
	}),
);
var CT = E('ZodNumberFormat', (e, t) => {
	dd.init(e, t), _T.init(e, t);
});
function co(e) {
	return fm(CT, e);
}
var zT = E('ZodUnknown', (e, t) => {
	md.init(e, t), se.init(e, t), e._zod.processJSONSchema = (r, n, i) => Lm(e, r, n, i);
});
function lg() {
	return pm(zT);
}
var TT = E('ZodNever', (e, t) => {
	gd.init(e, t), se.init(e, t), e._zod.processJSONSchema = (r, n, i) => $m(e, r, n, i);
});
function bg(e) {
	return hm(TT, e);
}
var AT = E('ZodArray', (e, t) => {
	ic(), yd.init(e, t), se.init(e, t), e._zod.processJSONSchema = (r, n, i) => Fm(e, r, n, i), e.element = t.element;
}, {
	min(e, t) {
		return this.check(kr(e, t));
	},
	nonempty(e) {
		return this.check(kr(1, e));
	},
	max(e, t) {
		return this.check(io(e, t));
	},
	length(e, t) {
		return this.check(oo(e, t));
	},
	unwrap() {
		return this.element;
	},
});
function Le(e, t) {
	return dm(AT, e, t);
}
var ET = E('ZodObject', (e, t) => {
	ic(),
		kd.init(e, t),
		se.init(e, t),
		e._zod.processJSONSchema = (r, n, i) => Rm(e, r, n, i),
		cz(e, 'shape', (r) => r._zod.def.shape, !1);
}, {
	keyof() {
		return ut(Object.keys(this._zod.def.shape));
	},
	catchall(e) {
		return this.clone(ze(this._zod.def, { catchall: e }));
	},
	passthrough() {
		return this.clone(ze(this._zod.def, { catchall: lg() }));
	},
	loose() {
		return this.clone(ze(this._zod.def, { catchall: lg() }));
	},
	strict() {
		return this.clone(ze(this._zod.def, { catchall: bg() }));
	},
	strip() {
		return this.clone(ze(this._zod.def, { catchall: void 0 }));
	},
	extend(e) {
		return ez(this, e);
	},
	safeExtend(e) {
		return tz(this, e);
	},
	merge(e) {
		return rz(this, e);
	},
	pick(e) {
		return QC(this, e);
	},
	omit(e) {
		return XC(this, e);
	},
	partial(...e) {
		return Sp(kg, this, e[0]);
	},
	exactPartial(...e) {
		return Sp(wg, this, e[0], 'exactPartial');
	},
	required(...e) {
		return nz(Sg, this, e[0]);
	},
});
function Ne(e, t) {
	return new ET({ type: 'object', shape: e, catchall: bg(), ...B(t) });
}
var IT = E('ZodUnion', (e, t) => {
	wd.init(e, t), se.init(e, t), e._zod.processJSONSchema = (r, n, i) => Bm(e, r, n, i), e.options = t.options;
});
function PT(e, t) {
	return new IT({ type: 'union', options: e, ...B(t) });
}
var OT = E('ZodIntersection', (e, t) => {
	Sd.init(e, t), se.init(e, t), e._zod.processJSONSchema = (r, n, i) => Zm(e, r, n, i);
});
function $T(e, t) {
	return new OT({ type: 'intersection', left: e, right: t });
}
var nc = E('ZodEnum', (e, t) => {
	vd.init(e, t),
		se.init(e, t),
		e._zod.processJSONSchema = (n, i, o) => Nm(e, n, i, o),
		e.enum = t.entries,
		e.options = [...e._zod.values];
	let r = new Set(Object.keys(t.entries));
	e.extract = (n, i) => {
		let o = {};
		for (let s of n) {
			if (r.has(s)) o[s] = t.entries[s];
			else throw Error(`Key ${s} not found in enum`);
		}
		return new nc({ ...t, checks: [], ...B(i), entries: o });
	},
		e.exclude = (n, i) => {
			let o = { ...t.entries };
			for (let s of n) {
				if (r.has(s)) delete o[s];
				else throw Error(`Key ${s} not found in enum`);
			}
			return new nc({ ...t, checks: [], ...B(i), entries: o });
		};
});
function ut(e, t) {
	let r = Array.isArray(e) ? Object.fromEntries(e.map((n) => [n, n])) : e;
	return new nc({ type: 'enum', entries: r, ...B(t) });
}
var LT = E('ZodLiteral', (e, t) => {
	_d.init(e, t),
		se.init(e, t),
		e._zod.processJSONSchema = (r, n, i) => qm(e, r, n, i),
		e.values = new Set(t.values),
		Object.defineProperty(e, 'value', {
			get() {
				if (t.values.length > 1) {
					throw Error('This schema contains multiple valid literal values. Use `.values` instead.');
				}
				return t.values[0];
			},
		});
});
function xg(e, t) {
	return new LT({ type: 'literal', values: Array.isArray(e) ? e : [e], ...B(t) });
}
var NT = E('ZodTransform', (e, t) => {
	ic(),
		Cd.init(e, t),
		se.init(e, t),
		e._zod.processJSONSchema = (r, n, i) => Mm(e, r, n, i),
		e._zod.parse = (r, n) => {
			if (n.direction === 'backward') throw new fn(e.constructor.name);
			r.addIssue = (o) => {
				if (typeof o === 'string') r.issues.push(Zt(o, r.value, t));
				else {
					let s = o;
					if (s.fatal) s.continue = !1;
					if (s.code ?? (s.code = 'custom'), !('input' in s)) s.input = r.value;
					s.inst ?? (s.inst = e), r.issues.push(Zt(s));
				}
			};
			let i = t.transform(r.value, r);
			if (i instanceof Promise) return i.then((o) => (r.value = o, r));
			return r.value = i, r;
		};
});
function qT(e) {
	return new NT({ type: 'transform', transform: e });
}
var kg = E('ZodOptional', (e, t) => {
	Oa.init(e, t),
		se.init(e, t),
		e._zod.processJSONSchema = (r, n, i) => rc(e, r, n, i),
		e.unwrap = () => e._zod.def.innerType;
});
function fg(e) {
	return new kg({ type: 'optional', innerType: e });
}
var wg = E('ZodExactOptional', (e, t) => {
	zd.init(e, t),
		se.init(e, t),
		e._zod.processJSONSchema = (r, n, i) => rc(e, r, n, i),
		e.unwrap = () => e._zod.def.innerType;
});
function DT(e) {
	return new wg({ type: 'optional', innerType: e });
}
var MT = E('ZodNullable', (e, t) => {
	Td.init(e, t),
		se.init(e, t),
		e._zod.processJSONSchema = (r, n, i) => jm(e, r, n, i),
		e.unwrap = () => e._zod.def.innerType;
});
function pg(e) {
	return new MT({ type: 'nullable', innerType: e });
}
var FT = E('ZodDefault', (e, t) => {
	Ad.init(e, t),
		se.init(e, t),
		e._zod.processJSONSchema = (r, n, i) => Km(e, r, n, i),
		e.unwrap = () => e._zod.def.innerType,
		e.removeDefault = e.unwrap;
});
function RT(e, t) {
	return new FT({
		type: 'default',
		innerType: e,
		get defaultValue() {
			return typeof t === 'function' ? t() : pa(t);
		},
	});
}
var BT = E('ZodPrefault', (e, t) => {
	Ed.init(e, t),
		se.init(e, t),
		e._zod.processJSONSchema = (r, n, i) => Jm(e, r, n, i),
		e.unwrap = () => e._zod.def.innerType;
});
function ZT(e, t) {
	return new BT({
		type: 'prefault',
		innerType: e,
		get defaultValue() {
			return typeof t === 'function' ? t() : pa(t);
		},
	});
}
var Sg = E('ZodNonOptional', (e, t) => {
	Id.init(e, t),
		se.init(e, t),
		e._zod.processJSONSchema = (r, n, i) => Um(e, r, n, i),
		e.unwrap = () => e._zod.def.innerType;
});
function jT(e, t) {
	return new Sg({ type: 'nonoptional', innerType: e, ...B(t) });
}
var UT = E('ZodCatch', (e, t) => {
	Pd.init(e, t),
		se.init(e, t),
		e._zod.processJSONSchema = (r, n, i) => Hm(e, r, n, i),
		e.unwrap = () => e._zod.def.innerType,
		e.removeCatch = e.unwrap;
});
function VT(e, t) {
	return new UT({ type: 'catch', innerType: e, catchValue: typeof t === 'function' ? t : Tp(t) });
}
var KT = E('ZodPipe', (e, t) => {
	Od.init(e, t), se.init(e, t), e._zod.processJSONSchema = (r, n, i) => Gm(e, r, n, i), e.in = t.in, e.out = t.out;
});
function hg(e, t) {
	return new KT({ type: 'pipe', in: e, out: t });
}
var JT = E('ZodReadonly', (e, t) => {
	$d.init(e, t),
		se.init(e, t),
		e._zod.processJSONSchema = (r, n, i) => Wm(e, r, n, i),
		e.unwrap = () => e._zod.def.innerType;
});
function HT(e) {
	return new JT({ type: 'readonly', innerType: e });
}
var GT = E('ZodCustom', (e, t) => {
	Ld.init(e, t), se.init(e, t), e._zod.processJSONSchema = (r, n, i) => Dm(e, r, n, i);
});
function WT(e, t = {}) {
	return mm(GT, e, t);
}
function YT(e, t) {
	return gm(e, t);
}
function QT(e) {
	return eo(oc, e);
}
class _g extends Error {
	name = 'Assertion';
	code = 'ERR_ASSERTION';
	constructor(e, t, r, n, i) {
		super(e);
		if (Error.captureStackTrace) Error.captureStackTrace(this, this.constructor);
		this.actual = t, this.expected = r, this.generated = i, this.operator = n;
	}
}
function b(e, t) {
	XT(Boolean(e), !1, !0, 'ok', 'Expected value to be truthy', t);
}
function XT(e, t, r, n, i, o) {
	if (!e) throw o instanceof Error ? o : new _g(o || i, t, r, n, !o);
}
var eA = {};
function Ut(e, t) {
	let r = t || eA,
		n = typeof r.includeImageAlt === 'boolean' ? r.includeImageAlt : !0,
		i = typeof r.includeHtml === 'boolean' ? r.includeHtml : !0;
	return zg(e, n, i);
}
function zg(e, t, r) {
	if (tA(e)) {
		if ('value' in e) return e.type === 'html' && !r ? '' : e.value;
		if (t && 'alt' in e && e.alt) return e.alt;
		if ('children' in e) return Cg(e.children, t, r);
	}
	if (Array.isArray(e)) return Cg(e, t, r);
	return '';
}
function Cg(e, t, r) {
	let n = [], i = -1;
	while (++i < e.length) n[i] = zg(e[i], t, r);
	return n.join('');
}
function tA(e) {
	return Boolean(e && typeof e === 'object');
}
var sc = {
	AElig: 'Æ',
	AMP: '&',
	Aacute: 'Á',
	Abreve: 'Ă',
	Acirc: 'Â',
	Acy: 'А',
	Afr: '\uD835\uDD04',
	Agrave: 'À',
	Alpha: 'Α',
	Amacr: 'Ā',
	And: '⩓',
	Aogon: 'Ą',
	Aopf: '\uD835\uDD38',
	ApplyFunction: '⁡',
	Aring: 'Å',
	Ascr: '\uD835\uDC9C',
	Assign: '≔',
	Atilde: 'Ã',
	Auml: 'Ä',
	Backslash: '∖',
	Barv: '⫧',
	Barwed: '⌆',
	Bcy: 'Б',
	Because: '∵',
	Bernoullis: 'ℬ',
	Beta: 'Β',
	Bfr: '\uD835\uDD05',
	Bopf: '\uD835\uDD39',
	Breve: '˘',
	Bscr: 'ℬ',
	Bumpeq: '≎',
	CHcy: 'Ч',
	COPY: '©',
	Cacute: 'Ć',
	Cap: '⋒',
	CapitalDifferentialD: 'ⅅ',
	Cayleys: 'ℭ',
	Ccaron: 'Č',
	Ccedil: 'Ç',
	Ccirc: 'Ĉ',
	Cconint: '∰',
	Cdot: 'Ċ',
	Cedilla: '¸',
	CenterDot: '·',
	Cfr: 'ℭ',
	Chi: 'Χ',
	CircleDot: '⊙',
	CircleMinus: '⊖',
	CirclePlus: '⊕',
	CircleTimes: '⊗',
	ClockwiseContourIntegral: '∲',
	CloseCurlyDoubleQuote: '”',
	CloseCurlyQuote: '’',
	Colon: '∷',
	Colone: '⩴',
	Congruent: '≡',
	Conint: '∯',
	ContourIntegral: '∮',
	Copf: 'ℂ',
	Coproduct: '∐',
	CounterClockwiseContourIntegral: '∳',
	Cross: '⨯',
	Cscr: '\uD835\uDC9E',
	Cup: '⋓',
	CupCap: '≍',
	DD: 'ⅅ',
	DDotrahd: '⤑',
	DJcy: 'Ђ',
	DScy: 'Ѕ',
	DZcy: 'Џ',
	Dagger: '‡',
	Darr: '↡',
	Dashv: '⫤',
	Dcaron: 'Ď',
	Dcy: 'Д',
	Del: '∇',
	Delta: 'Δ',
	Dfr: '\uD835\uDD07',
	DiacriticalAcute: '´',
	DiacriticalDot: '˙',
	DiacriticalDoubleAcute: '˝',
	DiacriticalGrave: '`',
	DiacriticalTilde: '˜',
	Diamond: '⋄',
	DifferentialD: 'ⅆ',
	Dopf: '\uD835\uDD3B',
	Dot: '¨',
	DotDot: '⃜',
	DotEqual: '≐',
	DoubleContourIntegral: '∯',
	DoubleDot: '¨',
	DoubleDownArrow: '⇓',
	DoubleLeftArrow: '⇐',
	DoubleLeftRightArrow: '⇔',
	DoubleLeftTee: '⫤',
	DoubleLongLeftArrow: '⟸',
	DoubleLongLeftRightArrow: '⟺',
	DoubleLongRightArrow: '⟹',
	DoubleRightArrow: '⇒',
	DoubleRightTee: '⊨',
	DoubleUpArrow: '⇑',
	DoubleUpDownArrow: '⇕',
	DoubleVerticalBar: '∥',
	DownArrow: '↓',
	DownArrowBar: '⤓',
	DownArrowUpArrow: '⇵',
	DownBreve: '̑',
	DownLeftRightVector: '⥐',
	DownLeftTeeVector: '⥞',
	DownLeftVector: '↽',
	DownLeftVectorBar: '⥖',
	DownRightTeeVector: '⥟',
	DownRightVector: '⇁',
	DownRightVectorBar: '⥗',
	DownTee: '⊤',
	DownTeeArrow: '↧',
	Downarrow: '⇓',
	Dscr: '\uD835\uDC9F',
	Dstrok: 'Đ',
	ENG: 'Ŋ',
	ETH: 'Ð',
	Eacute: 'É',
	Ecaron: 'Ě',
	Ecirc: 'Ê',
	Ecy: 'Э',
	Edot: 'Ė',
	Efr: '\uD835\uDD08',
	Egrave: 'È',
	Element: '∈',
	Emacr: 'Ē',
	EmptySmallSquare: '◻',
	EmptyVerySmallSquare: '▫',
	Eogon: 'Ę',
	Eopf: '\uD835\uDD3C',
	Epsilon: 'Ε',
	Equal: '⩵',
	EqualTilde: '≂',
	Equilibrium: '⇌',
	Escr: 'ℰ',
	Esim: '⩳',
	Eta: 'Η',
	Euml: 'Ë',
	Exists: '∃',
	ExponentialE: 'ⅇ',
	Fcy: 'Ф',
	Ffr: '\uD835\uDD09',
	FilledSmallSquare: '◼',
	FilledVerySmallSquare: '▪',
	Fopf: '\uD835\uDD3D',
	ForAll: '∀',
	Fouriertrf: 'ℱ',
	Fscr: 'ℱ',
	GJcy: 'Ѓ',
	GT: '>',
	Gamma: 'Γ',
	Gammad: 'Ϝ',
	Gbreve: 'Ğ',
	Gcedil: 'Ģ',
	Gcirc: 'Ĝ',
	Gcy: 'Г',
	Gdot: 'Ġ',
	Gfr: '\uD835\uDD0A',
	Gg: '⋙',
	Gopf: '\uD835\uDD3E',
	GreaterEqual: '≥',
	GreaterEqualLess: '⋛',
	GreaterFullEqual: '≧',
	GreaterGreater: '⪢',
	GreaterLess: '≷',
	GreaterSlantEqual: '⩾',
	GreaterTilde: '≳',
	Gscr: '\uD835\uDCA2',
	Gt: '≫',
	HARDcy: 'Ъ',
	Hacek: 'ˇ',
	Hat: '^',
	Hcirc: 'Ĥ',
	Hfr: 'ℌ',
	HilbertSpace: 'ℋ',
	Hopf: 'ℍ',
	HorizontalLine: '─',
	Hscr: 'ℋ',
	Hstrok: 'Ħ',
	HumpDownHump: '≎',
	HumpEqual: '≏',
	IEcy: 'Е',
	IJlig: 'Ĳ',
	IOcy: 'Ё',
	Iacute: 'Í',
	Icirc: 'Î',
	Icy: 'И',
	Idot: 'İ',
	Ifr: 'ℑ',
	Igrave: 'Ì',
	Im: 'ℑ',
	Imacr: 'Ī',
	ImaginaryI: 'ⅈ',
	Implies: '⇒',
	Int: '∬',
	Integral: '∫',
	Intersection: '⋂',
	InvisibleComma: '⁣',
	InvisibleTimes: '⁢',
	Iogon: 'Į',
	Iopf: '\uD835\uDD40',
	Iota: 'Ι',
	Iscr: 'ℐ',
	Itilde: 'Ĩ',
	Iukcy: 'І',
	Iuml: 'Ï',
	Jcirc: 'Ĵ',
	Jcy: 'Й',
	Jfr: '\uD835\uDD0D',
	Jopf: '\uD835\uDD41',
	Jscr: '\uD835\uDCA5',
	Jsercy: 'Ј',
	Jukcy: 'Є',
	KHcy: 'Х',
	KJcy: 'Ќ',
	Kappa: 'Κ',
	Kcedil: 'Ķ',
	Kcy: 'К',
	Kfr: '\uD835\uDD0E',
	Kopf: '\uD835\uDD42',
	Kscr: '\uD835\uDCA6',
	LJcy: 'Љ',
	LT: '<',
	Lacute: 'Ĺ',
	Lambda: 'Λ',
	Lang: '⟪',
	Laplacetrf: 'ℒ',
	Larr: '↞',
	Lcaron: 'Ľ',
	Lcedil: 'Ļ',
	Lcy: 'Л',
	LeftAngleBracket: '⟨',
	LeftArrow: '←',
	LeftArrowBar: '⇤',
	LeftArrowRightArrow: '⇆',
	LeftCeiling: '⌈',
	LeftDoubleBracket: '⟦',
	LeftDownTeeVector: '⥡',
	LeftDownVector: '⇃',
	LeftDownVectorBar: '⥙',
	LeftFloor: '⌊',
	LeftRightArrow: '↔',
	LeftRightVector: '⥎',
	LeftTee: '⊣',
	LeftTeeArrow: '↤',
	LeftTeeVector: '⥚',
	LeftTriangle: '⊲',
	LeftTriangleBar: '⧏',
	LeftTriangleEqual: '⊴',
	LeftUpDownVector: '⥑',
	LeftUpTeeVector: '⥠',
	LeftUpVector: '↿',
	LeftUpVectorBar: '⥘',
	LeftVector: '↼',
	LeftVectorBar: '⥒',
	Leftarrow: '⇐',
	Leftrightarrow: '⇔',
	LessEqualGreater: '⋚',
	LessFullEqual: '≦',
	LessGreater: '≶',
	LessLess: '⪡',
	LessSlantEqual: '⩽',
	LessTilde: '≲',
	Lfr: '\uD835\uDD0F',
	Ll: '⋘',
	Lleftarrow: '⇚',
	Lmidot: 'Ŀ',
	LongLeftArrow: '⟵',
	LongLeftRightArrow: '⟷',
	LongRightArrow: '⟶',
	Longleftarrow: '⟸',
	Longleftrightarrow: '⟺',
	Longrightarrow: '⟹',
	Lopf: '\uD835\uDD43',
	LowerLeftArrow: '↙',
	LowerRightArrow: '↘',
	Lscr: 'ℒ',
	Lsh: '↰',
	Lstrok: 'Ł',
	Lt: '≪',
	Map: '⤅',
	Mcy: 'М',
	MediumSpace: ' ',
	Mellintrf: 'ℳ',
	Mfr: '\uD835\uDD10',
	MinusPlus: '∓',
	Mopf: '\uD835\uDD44',
	Mscr: 'ℳ',
	Mu: 'Μ',
	NJcy: 'Њ',
	Nacute: 'Ń',
	Ncaron: 'Ň',
	Ncedil: 'Ņ',
	Ncy: 'Н',
	NegativeMediumSpace: '​',
	NegativeThickSpace: '​',
	NegativeThinSpace: '​',
	NegativeVeryThinSpace: '​',
	NestedGreaterGreater: '≫',
	NestedLessLess: '≪',
	NewLine: `
`,
	Nfr: '\uD835\uDD11',
	NoBreak: '⁠',
	NonBreakingSpace: ' ',
	Nopf: 'ℕ',
	Not: '⫬',
	NotCongruent: '≢',
	NotCupCap: '≭',
	NotDoubleVerticalBar: '∦',
	NotElement: '∉',
	NotEqual: '≠',
	NotEqualTilde: '≂̸',
	NotExists: '∄',
	NotGreater: '≯',
	NotGreaterEqual: '≱',
	NotGreaterFullEqual: '≧̸',
	NotGreaterGreater: '≫̸',
	NotGreaterLess: '≹',
	NotGreaterSlantEqual: '⩾̸',
	NotGreaterTilde: '≵',
	NotHumpDownHump: '≎̸',
	NotHumpEqual: '≏̸',
	NotLeftTriangle: '⋪',
	NotLeftTriangleBar: '⧏̸',
	NotLeftTriangleEqual: '⋬',
	NotLess: '≮',
	NotLessEqual: '≰',
	NotLessGreater: '≸',
	NotLessLess: '≪̸',
	NotLessSlantEqual: '⩽̸',
	NotLessTilde: '≴',
	NotNestedGreaterGreater: '⪢̸',
	NotNestedLessLess: '⪡̸',
	NotPrecedes: '⊀',
	NotPrecedesEqual: '⪯̸',
	NotPrecedesSlantEqual: '⋠',
	NotReverseElement: '∌',
	NotRightTriangle: '⋫',
	NotRightTriangleBar: '⧐̸',
	NotRightTriangleEqual: '⋭',
	NotSquareSubset: '⊏̸',
	NotSquareSubsetEqual: '⋢',
	NotSquareSuperset: '⊐̸',
	NotSquareSupersetEqual: '⋣',
	NotSubset: '⊂⃒',
	NotSubsetEqual: '⊈',
	NotSucceeds: '⊁',
	NotSucceedsEqual: '⪰̸',
	NotSucceedsSlantEqual: '⋡',
	NotSucceedsTilde: '≿̸',
	NotSuperset: '⊃⃒',
	NotSupersetEqual: '⊉',
	NotTilde: '≁',
	NotTildeEqual: '≄',
	NotTildeFullEqual: '≇',
	NotTildeTilde: '≉',
	NotVerticalBar: '∤',
	Nscr: '\uD835\uDCA9',
	Ntilde: 'Ñ',
	Nu: 'Ν',
	OElig: 'Œ',
	Oacute: 'Ó',
	Ocirc: 'Ô',
	Ocy: 'О',
	Odblac: 'Ő',
	Ofr: '\uD835\uDD12',
	Ograve: 'Ò',
	Omacr: 'Ō',
	Omega: 'Ω',
	Omicron: 'Ο',
	Oopf: '\uD835\uDD46',
	OpenCurlyDoubleQuote: '“',
	OpenCurlyQuote: '‘',
	Or: '⩔',
	Oscr: '\uD835\uDCAA',
	Oslash: 'Ø',
	Otilde: 'Õ',
	Otimes: '⨷',
	Ouml: 'Ö',
	OverBar: '‾',
	OverBrace: '⏞',
	OverBracket: '⎴',
	OverParenthesis: '⏜',
	PartialD: '∂',
	Pcy: 'П',
	Pfr: '\uD835\uDD13',
	Phi: 'Φ',
	Pi: 'Π',
	PlusMinus: '±',
	Poincareplane: 'ℌ',
	Popf: 'ℙ',
	Pr: '⪻',
	Precedes: '≺',
	PrecedesEqual: '⪯',
	PrecedesSlantEqual: '≼',
	PrecedesTilde: '≾',
	Prime: '″',
	Product: '∏',
	Proportion: '∷',
	Proportional: '∝',
	Pscr: '\uD835\uDCAB',
	Psi: 'Ψ',
	QUOT: '"',
	Qfr: '\uD835\uDD14',
	Qopf: 'ℚ',
	Qscr: '\uD835\uDCAC',
	RBarr: '⤐',
	REG: '®',
	Racute: 'Ŕ',
	Rang: '⟫',
	Rarr: '↠',
	Rarrtl: '⤖',
	Rcaron: 'Ř',
	Rcedil: 'Ŗ',
	Rcy: 'Р',
	Re: 'ℜ',
	ReverseElement: '∋',
	ReverseEquilibrium: '⇋',
	ReverseUpEquilibrium: '⥯',
	Rfr: 'ℜ',
	Rho: 'Ρ',
	RightAngleBracket: '⟩',
	RightArrow: '→',
	RightArrowBar: '⇥',
	RightArrowLeftArrow: '⇄',
	RightCeiling: '⌉',
	RightDoubleBracket: '⟧',
	RightDownTeeVector: '⥝',
	RightDownVector: '⇂',
	RightDownVectorBar: '⥕',
	RightFloor: '⌋',
	RightTee: '⊢',
	RightTeeArrow: '↦',
	RightTeeVector: '⥛',
	RightTriangle: '⊳',
	RightTriangleBar: '⧐',
	RightTriangleEqual: '⊵',
	RightUpDownVector: '⥏',
	RightUpTeeVector: '⥜',
	RightUpVector: '↾',
	RightUpVectorBar: '⥔',
	RightVector: '⇀',
	RightVectorBar: '⥓',
	Rightarrow: '⇒',
	Ropf: 'ℝ',
	RoundImplies: '⥰',
	Rrightarrow: '⇛',
	Rscr: 'ℛ',
	Rsh: '↱',
	RuleDelayed: '⧴',
	SHCHcy: 'Щ',
	SHcy: 'Ш',
	SOFTcy: 'Ь',
	Sacute: 'Ś',
	Sc: '⪼',
	Scaron: 'Š',
	Scedil: 'Ş',
	Scirc: 'Ŝ',
	Scy: 'С',
	Sfr: '\uD835\uDD16',
	ShortDownArrow: '↓',
	ShortLeftArrow: '←',
	ShortRightArrow: '→',
	ShortUpArrow: '↑',
	Sigma: 'Σ',
	SmallCircle: '∘',
	Sopf: '\uD835\uDD4A',
	Sqrt: '√',
	Square: '□',
	SquareIntersection: '⊓',
	SquareSubset: '⊏',
	SquareSubsetEqual: '⊑',
	SquareSuperset: '⊐',
	SquareSupersetEqual: '⊒',
	SquareUnion: '⊔',
	Sscr: '\uD835\uDCAE',
	Star: '⋆',
	Sub: '⋐',
	Subset: '⋐',
	SubsetEqual: '⊆',
	Succeeds: '≻',
	SucceedsEqual: '⪰',
	SucceedsSlantEqual: '≽',
	SucceedsTilde: '≿',
	SuchThat: '∋',
	Sum: '∑',
	Sup: '⋑',
	Superset: '⊃',
	SupersetEqual: '⊇',
	Supset: '⋑',
	THORN: 'Þ',
	TRADE: '™',
	TSHcy: 'Ћ',
	TScy: 'Ц',
	Tab: '\t',
	Tau: 'Τ',
	Tcaron: 'Ť',
	Tcedil: 'Ţ',
	Tcy: 'Т',
	Tfr: '\uD835\uDD17',
	Therefore: '∴',
	Theta: 'Θ',
	ThickSpace: '  ',
	ThinSpace: ' ',
	Tilde: '∼',
	TildeEqual: '≃',
	TildeFullEqual: '≅',
	TildeTilde: '≈',
	Topf: '\uD835\uDD4B',
	TripleDot: '⃛',
	Tscr: '\uD835\uDCAF',
	Tstrok: 'Ŧ',
	Uacute: 'Ú',
	Uarr: '↟',
	Uarrocir: '⥉',
	Ubrcy: 'Ў',
	Ubreve: 'Ŭ',
	Ucirc: 'Û',
	Ucy: 'У',
	Udblac: 'Ű',
	Ufr: '\uD835\uDD18',
	Ugrave: 'Ù',
	Umacr: 'Ū',
	UnderBar: '_',
	UnderBrace: '⏟',
	UnderBracket: '⎵',
	UnderParenthesis: '⏝',
	Union: '⋃',
	UnionPlus: '⊎',
	Uogon: 'Ų',
	Uopf: '\uD835\uDD4C',
	UpArrow: '↑',
	UpArrowBar: '⤒',
	UpArrowDownArrow: '⇅',
	UpDownArrow: '↕',
	UpEquilibrium: '⥮',
	UpTee: '⊥',
	UpTeeArrow: '↥',
	Uparrow: '⇑',
	Updownarrow: '⇕',
	UpperLeftArrow: '↖',
	UpperRightArrow: '↗',
	Upsi: 'ϒ',
	Upsilon: 'Υ',
	Uring: 'Ů',
	Uscr: '\uD835\uDCB0',
	Utilde: 'Ũ',
	Uuml: 'Ü',
	VDash: '⊫',
	Vbar: '⫫',
	Vcy: 'В',
	Vdash: '⊩',
	Vdashl: '⫦',
	Vee: '⋁',
	Verbar: '‖',
	Vert: '‖',
	VerticalBar: '∣',
	VerticalLine: '|',
	VerticalSeparator: '❘',
	VerticalTilde: '≀',
	VeryThinSpace: ' ',
	Vfr: '\uD835\uDD19',
	Vopf: '\uD835\uDD4D',
	Vscr: '\uD835\uDCB1',
	Vvdash: '⊪',
	Wcirc: 'Ŵ',
	Wedge: '⋀',
	Wfr: '\uD835\uDD1A',
	Wopf: '\uD835\uDD4E',
	Wscr: '\uD835\uDCB2',
	Xfr: '\uD835\uDD1B',
	Xi: 'Ξ',
	Xopf: '\uD835\uDD4F',
	Xscr: '\uD835\uDCB3',
	YAcy: 'Я',
	YIcy: 'Ї',
	YUcy: 'Ю',
	Yacute: 'Ý',
	Ycirc: 'Ŷ',
	Ycy: 'Ы',
	Yfr: '\uD835\uDD1C',
	Yopf: '\uD835\uDD50',
	Yscr: '\uD835\uDCB4',
	Yuml: 'Ÿ',
	ZHcy: 'Ж',
	Zacute: 'Ź',
	Zcaron: 'Ž',
	Zcy: 'З',
	Zdot: 'Ż',
	ZeroWidthSpace: '​',
	Zeta: 'Ζ',
	Zfr: 'ℨ',
	Zopf: 'ℤ',
	Zscr: '\uD835\uDCB5',
	aacute: 'á',
	abreve: 'ă',
	ac: '∾',
	acE: '∾̳',
	acd: '∿',
	acirc: 'â',
	acute: '´',
	acy: 'а',
	aelig: 'æ',
	af: '⁡',
	afr: '\uD835\uDD1E',
	agrave: 'à',
	alefsym: 'ℵ',
	aleph: 'ℵ',
	alpha: 'α',
	amacr: 'ā',
	amalg: '⨿',
	amp: '&',
	and: '∧',
	andand: '⩕',
	andd: '⩜',
	andslope: '⩘',
	andv: '⩚',
	ang: '∠',
	ange: '⦤',
	angle: '∠',
	angmsd: '∡',
	angmsdaa: '⦨',
	angmsdab: '⦩',
	angmsdac: '⦪',
	angmsdad: '⦫',
	angmsdae: '⦬',
	angmsdaf: '⦭',
	angmsdag: '⦮',
	angmsdah: '⦯',
	angrt: '∟',
	angrtvb: '⊾',
	angrtvbd: '⦝',
	angsph: '∢',
	angst: 'Å',
	angzarr: '⍼',
	aogon: 'ą',
	aopf: '\uD835\uDD52',
	ap: '≈',
	apE: '⩰',
	apacir: '⩯',
	ape: '≊',
	apid: '≋',
	apos: "'",
	approx: '≈',
	approxeq: '≊',
	aring: 'å',
	ascr: '\uD835\uDCB6',
	ast: '*',
	asymp: '≈',
	asympeq: '≍',
	atilde: 'ã',
	auml: 'ä',
	awconint: '∳',
	awint: '⨑',
	bNot: '⫭',
	backcong: '≌',
	backepsilon: '϶',
	backprime: '‵',
	backsim: '∽',
	backsimeq: '⋍',
	barvee: '⊽',
	barwed: '⌅',
	barwedge: '⌅',
	bbrk: '⎵',
	bbrktbrk: '⎶',
	bcong: '≌',
	bcy: 'б',
	bdquo: '„',
	becaus: '∵',
	because: '∵',
	bemptyv: '⦰',
	bepsi: '϶',
	bernou: 'ℬ',
	beta: 'β',
	beth: 'ℶ',
	between: '≬',
	bfr: '\uD835\uDD1F',
	bigcap: '⋂',
	bigcirc: '◯',
	bigcup: '⋃',
	bigodot: '⨀',
	bigoplus: '⨁',
	bigotimes: '⨂',
	bigsqcup: '⨆',
	bigstar: '★',
	bigtriangledown: '▽',
	bigtriangleup: '△',
	biguplus: '⨄',
	bigvee: '⋁',
	bigwedge: '⋀',
	bkarow: '⤍',
	blacklozenge: '⧫',
	blacksquare: '▪',
	blacktriangle: '▴',
	blacktriangledown: '▾',
	blacktriangleleft: '◂',
	blacktriangleright: '▸',
	blank: '␣',
	blk12: '▒',
	blk14: '░',
	blk34: '▓',
	block: '█',
	bne: '=⃥',
	bnequiv: '≡⃥',
	bnot: '⌐',
	bopf: '\uD835\uDD53',
	bot: '⊥',
	bottom: '⊥',
	bowtie: '⋈',
	boxDL: '╗',
	boxDR: '╔',
	boxDl: '╖',
	boxDr: '╓',
	boxH: '═',
	boxHD: '╦',
	boxHU: '╩',
	boxHd: '╤',
	boxHu: '╧',
	boxUL: '╝',
	boxUR: '╚',
	boxUl: '╜',
	boxUr: '╙',
	boxV: '║',
	boxVH: '╬',
	boxVL: '╣',
	boxVR: '╠',
	boxVh: '╫',
	boxVl: '╢',
	boxVr: '╟',
	boxbox: '⧉',
	boxdL: '╕',
	boxdR: '╒',
	boxdl: '┐',
	boxdr: '┌',
	boxh: '─',
	boxhD: '╥',
	boxhU: '╨',
	boxhd: '┬',
	boxhu: '┴',
	boxminus: '⊟',
	boxplus: '⊞',
	boxtimes: '⊠',
	boxuL: '╛',
	boxuR: '╘',
	boxul: '┘',
	boxur: '└',
	boxv: '│',
	boxvH: '╪',
	boxvL: '╡',
	boxvR: '╞',
	boxvh: '┼',
	boxvl: '┤',
	boxvr: '├',
	bprime: '‵',
	breve: '˘',
	brvbar: '¦',
	bscr: '\uD835\uDCB7',
	bsemi: '⁏',
	bsim: '∽',
	bsime: '⋍',
	bsol: '\\',
	bsolb: '⧅',
	bsolhsub: '⟈',
	bull: '•',
	bullet: '•',
	bump: '≎',
	bumpE: '⪮',
	bumpe: '≏',
	bumpeq: '≏',
	cacute: 'ć',
	cap: '∩',
	capand: '⩄',
	capbrcup: '⩉',
	capcap: '⩋',
	capcup: '⩇',
	capdot: '⩀',
	caps: '∩︀',
	caret: '⁁',
	caron: 'ˇ',
	ccaps: '⩍',
	ccaron: 'č',
	ccedil: 'ç',
	ccirc: 'ĉ',
	ccups: '⩌',
	ccupssm: '⩐',
	cdot: 'ċ',
	cedil: '¸',
	cemptyv: '⦲',
	cent: '¢',
	centerdot: '·',
	cfr: '\uD835\uDD20',
	chcy: 'ч',
	check: '✓',
	checkmark: '✓',
	chi: 'χ',
	cir: '○',
	cirE: '⧃',
	circ: 'ˆ',
	circeq: '≗',
	circlearrowleft: '↺',
	circlearrowright: '↻',
	circledR: '®',
	circledS: 'Ⓢ',
	circledast: '⊛',
	circledcirc: '⊚',
	circleddash: '⊝',
	cire: '≗',
	cirfnint: '⨐',
	cirmid: '⫯',
	cirscir: '⧂',
	clubs: '♣',
	clubsuit: '♣',
	colon: ':',
	colone: '≔',
	coloneq: '≔',
	comma: ',',
	commat: '@',
	comp: '∁',
	compfn: '∘',
	complement: '∁',
	complexes: 'ℂ',
	cong: '≅',
	congdot: '⩭',
	conint: '∮',
	copf: '\uD835\uDD54',
	coprod: '∐',
	copy: '©',
	copysr: '℗',
	crarr: '↵',
	cross: '✗',
	cscr: '\uD835\uDCB8',
	csub: '⫏',
	csube: '⫑',
	csup: '⫐',
	csupe: '⫒',
	ctdot: '⋯',
	cudarrl: '⤸',
	cudarrr: '⤵',
	cuepr: '⋞',
	cuesc: '⋟',
	cularr: '↶',
	cularrp: '⤽',
	cup: '∪',
	cupbrcap: '⩈',
	cupcap: '⩆',
	cupcup: '⩊',
	cupdot: '⊍',
	cupor: '⩅',
	cups: '∪︀',
	curarr: '↷',
	curarrm: '⤼',
	curlyeqprec: '⋞',
	curlyeqsucc: '⋟',
	curlyvee: '⋎',
	curlywedge: '⋏',
	curren: '¤',
	curvearrowleft: '↶',
	curvearrowright: '↷',
	cuvee: '⋎',
	cuwed: '⋏',
	cwconint: '∲',
	cwint: '∱',
	cylcty: '⌭',
	dArr: '⇓',
	dHar: '⥥',
	dagger: '†',
	daleth: 'ℸ',
	darr: '↓',
	dash: '‐',
	dashv: '⊣',
	dbkarow: '⤏',
	dblac: '˝',
	dcaron: 'ď',
	dcy: 'д',
	dd: 'ⅆ',
	ddagger: '‡',
	ddarr: '⇊',
	ddotseq: '⩷',
	deg: '°',
	delta: 'δ',
	demptyv: '⦱',
	dfisht: '⥿',
	dfr: '\uD835\uDD21',
	dharl: '⇃',
	dharr: '⇂',
	diam: '⋄',
	diamond: '⋄',
	diamondsuit: '♦',
	diams: '♦',
	die: '¨',
	digamma: 'ϝ',
	disin: '⋲',
	div: '÷',
	divide: '÷',
	divideontimes: '⋇',
	divonx: '⋇',
	djcy: 'ђ',
	dlcorn: '⌞',
	dlcrop: '⌍',
	dollar: '$',
	dopf: '\uD835\uDD55',
	dot: '˙',
	doteq: '≐',
	doteqdot: '≑',
	dotminus: '∸',
	dotplus: '∔',
	dotsquare: '⊡',
	doublebarwedge: '⌆',
	downarrow: '↓',
	downdownarrows: '⇊',
	downharpoonleft: '⇃',
	downharpoonright: '⇂',
	drbkarow: '⤐',
	drcorn: '⌟',
	drcrop: '⌌',
	dscr: '\uD835\uDCB9',
	dscy: 'ѕ',
	dsol: '⧶',
	dstrok: 'đ',
	dtdot: '⋱',
	dtri: '▿',
	dtrif: '▾',
	duarr: '⇵',
	duhar: '⥯',
	dwangle: '⦦',
	dzcy: 'џ',
	dzigrarr: '⟿',
	eDDot: '⩷',
	eDot: '≑',
	eacute: 'é',
	easter: '⩮',
	ecaron: 'ě',
	ecir: '≖',
	ecirc: 'ê',
	ecolon: '≕',
	ecy: 'э',
	edot: 'ė',
	ee: 'ⅇ',
	efDot: '≒',
	efr: '\uD835\uDD22',
	eg: '⪚',
	egrave: 'è',
	egs: '⪖',
	egsdot: '⪘',
	el: '⪙',
	elinters: '⏧',
	ell: 'ℓ',
	els: '⪕',
	elsdot: '⪗',
	emacr: 'ē',
	empty: '∅',
	emptyset: '∅',
	emptyv: '∅',
	emsp13: ' ',
	emsp14: ' ',
	emsp: ' ',
	eng: 'ŋ',
	ensp: ' ',
	eogon: 'ę',
	eopf: '\uD835\uDD56',
	epar: '⋕',
	eparsl: '⧣',
	eplus: '⩱',
	epsi: 'ε',
	epsilon: 'ε',
	epsiv: 'ϵ',
	eqcirc: '≖',
	eqcolon: '≕',
	eqsim: '≂',
	eqslantgtr: '⪖',
	eqslantless: '⪕',
	equals: '=',
	equest: '≟',
	equiv: '≡',
	equivDD: '⩸',
	eqvparsl: '⧥',
	erDot: '≓',
	erarr: '⥱',
	escr: 'ℯ',
	esdot: '≐',
	esim: '≂',
	eta: 'η',
	eth: 'ð',
	euml: 'ë',
	euro: '€',
	excl: '!',
	exist: '∃',
	expectation: 'ℰ',
	exponentiale: 'ⅇ',
	fallingdotseq: '≒',
	fcy: 'ф',
	female: '♀',
	ffilig: 'ﬃ',
	fflig: 'ﬀ',
	ffllig: 'ﬄ',
	ffr: '\uD835\uDD23',
	filig: 'ﬁ',
	fjlig: 'fj',
	flat: '♭',
	fllig: 'ﬂ',
	fltns: '▱',
	fnof: 'ƒ',
	fopf: '\uD835\uDD57',
	forall: '∀',
	fork: '⋔',
	forkv: '⫙',
	fpartint: '⨍',
	frac12: '½',
	frac13: '⅓',
	frac14: '¼',
	frac15: '⅕',
	frac16: '⅙',
	frac18: '⅛',
	frac23: '⅔',
	frac25: '⅖',
	frac34: '¾',
	frac35: '⅗',
	frac38: '⅜',
	frac45: '⅘',
	frac56: '⅚',
	frac58: '⅝',
	frac78: '⅞',
	frasl: '⁄',
	frown: '⌢',
	fscr: '\uD835\uDCBB',
	gE: '≧',
	gEl: '⪌',
	gacute: 'ǵ',
	gamma: 'γ',
	gammad: 'ϝ',
	gap: '⪆',
	gbreve: 'ğ',
	gcirc: 'ĝ',
	gcy: 'г',
	gdot: 'ġ',
	ge: '≥',
	gel: '⋛',
	geq: '≥',
	geqq: '≧',
	geqslant: '⩾',
	ges: '⩾',
	gescc: '⪩',
	gesdot: '⪀',
	gesdoto: '⪂',
	gesdotol: '⪄',
	gesl: '⋛︀',
	gesles: '⪔',
	gfr: '\uD835\uDD24',
	gg: '≫',
	ggg: '⋙',
	gimel: 'ℷ',
	gjcy: 'ѓ',
	gl: '≷',
	glE: '⪒',
	gla: '⪥',
	glj: '⪤',
	gnE: '≩',
	gnap: '⪊',
	gnapprox: '⪊',
	gne: '⪈',
	gneq: '⪈',
	gneqq: '≩',
	gnsim: '⋧',
	gopf: '\uD835\uDD58',
	grave: '`',
	gscr: 'ℊ',
	gsim: '≳',
	gsime: '⪎',
	gsiml: '⪐',
	gt: '>',
	gtcc: '⪧',
	gtcir: '⩺',
	gtdot: '⋗',
	gtlPar: '⦕',
	gtquest: '⩼',
	gtrapprox: '⪆',
	gtrarr: '⥸',
	gtrdot: '⋗',
	gtreqless: '⋛',
	gtreqqless: '⪌',
	gtrless: '≷',
	gtrsim: '≳',
	gvertneqq: '≩︀',
	gvnE: '≩︀',
	hArr: '⇔',
	hairsp: ' ',
	half: '½',
	hamilt: 'ℋ',
	hardcy: 'ъ',
	harr: '↔',
	harrcir: '⥈',
	harrw: '↭',
	hbar: 'ℏ',
	hcirc: 'ĥ',
	hearts: '♥',
	heartsuit: '♥',
	hellip: '…',
	hercon: '⊹',
	hfr: '\uD835\uDD25',
	hksearow: '⤥',
	hkswarow: '⤦',
	hoarr: '⇿',
	homtht: '∻',
	hookleftarrow: '↩',
	hookrightarrow: '↪',
	hopf: '\uD835\uDD59',
	horbar: '―',
	hscr: '\uD835\uDCBD',
	hslash: 'ℏ',
	hstrok: 'ħ',
	hybull: '⁃',
	hyphen: '‐',
	iacute: 'í',
	ic: '⁣',
	icirc: 'î',
	icy: 'и',
	iecy: 'е',
	iexcl: '¡',
	iff: '⇔',
	ifr: '\uD835\uDD26',
	igrave: 'ì',
	ii: 'ⅈ',
	iiiint: '⨌',
	iiint: '∭',
	iinfin: '⧜',
	iiota: '℩',
	ijlig: 'ĳ',
	imacr: 'ī',
	image: 'ℑ',
	imagline: 'ℐ',
	imagpart: 'ℑ',
	imath: 'ı',
	imof: '⊷',
	imped: 'Ƶ',
	in: '∈',
	incare: '℅',
	infin: '∞',
	infintie: '⧝',
	inodot: 'ı',
	int: '∫',
	intcal: '⊺',
	integers: 'ℤ',
	intercal: '⊺',
	intlarhk: '⨗',
	intprod: '⨼',
	iocy: 'ё',
	iogon: 'į',
	iopf: '\uD835\uDD5A',
	iota: 'ι',
	iprod: '⨼',
	iquest: '¿',
	iscr: '\uD835\uDCBE',
	isin: '∈',
	isinE: '⋹',
	isindot: '⋵',
	isins: '⋴',
	isinsv: '⋳',
	isinv: '∈',
	it: '⁢',
	itilde: 'ĩ',
	iukcy: 'і',
	iuml: 'ï',
	jcirc: 'ĵ',
	jcy: 'й',
	jfr: '\uD835\uDD27',
	jmath: 'ȷ',
	jopf: '\uD835\uDD5B',
	jscr: '\uD835\uDCBF',
	jsercy: 'ј',
	jukcy: 'є',
	kappa: 'κ',
	kappav: 'ϰ',
	kcedil: 'ķ',
	kcy: 'к',
	kfr: '\uD835\uDD28',
	kgreen: 'ĸ',
	khcy: 'х',
	kjcy: 'ќ',
	kopf: '\uD835\uDD5C',
	kscr: '\uD835\uDCC0',
	lAarr: '⇚',
	lArr: '⇐',
	lAtail: '⤛',
	lBarr: '⤎',
	lE: '≦',
	lEg: '⪋',
	lHar: '⥢',
	lacute: 'ĺ',
	laemptyv: '⦴',
	lagran: 'ℒ',
	lambda: 'λ',
	lang: '⟨',
	langd: '⦑',
	langle: '⟨',
	lap: '⪅',
	laquo: '«',
	larr: '←',
	larrb: '⇤',
	larrbfs: '⤟',
	larrfs: '⤝',
	larrhk: '↩',
	larrlp: '↫',
	larrpl: '⤹',
	larrsim: '⥳',
	larrtl: '↢',
	lat: '⪫',
	latail: '⤙',
	late: '⪭',
	lates: '⪭︀',
	lbarr: '⤌',
	lbbrk: '❲',
	lbrace: '{',
	lbrack: '[',
	lbrke: '⦋',
	lbrksld: '⦏',
	lbrkslu: '⦍',
	lcaron: 'ľ',
	lcedil: 'ļ',
	lceil: '⌈',
	lcub: '{',
	lcy: 'л',
	ldca: '⤶',
	ldquo: '“',
	ldquor: '„',
	ldrdhar: '⥧',
	ldrushar: '⥋',
	ldsh: '↲',
	le: '≤',
	leftarrow: '←',
	leftarrowtail: '↢',
	leftharpoondown: '↽',
	leftharpoonup: '↼',
	leftleftarrows: '⇇',
	leftrightarrow: '↔',
	leftrightarrows: '⇆',
	leftrightharpoons: '⇋',
	leftrightsquigarrow: '↭',
	leftthreetimes: '⋋',
	leg: '⋚',
	leq: '≤',
	leqq: '≦',
	leqslant: '⩽',
	les: '⩽',
	lescc: '⪨',
	lesdot: '⩿',
	lesdoto: '⪁',
	lesdotor: '⪃',
	lesg: '⋚︀',
	lesges: '⪓',
	lessapprox: '⪅',
	lessdot: '⋖',
	lesseqgtr: '⋚',
	lesseqqgtr: '⪋',
	lessgtr: '≶',
	lesssim: '≲',
	lfisht: '⥼',
	lfloor: '⌊',
	lfr: '\uD835\uDD29',
	lg: '≶',
	lgE: '⪑',
	lhard: '↽',
	lharu: '↼',
	lharul: '⥪',
	lhblk: '▄',
	ljcy: 'љ',
	ll: '≪',
	llarr: '⇇',
	llcorner: '⌞',
	llhard: '⥫',
	lltri: '◺',
	lmidot: 'ŀ',
	lmoust: '⎰',
	lmoustache: '⎰',
	lnE: '≨',
	lnap: '⪉',
	lnapprox: '⪉',
	lne: '⪇',
	lneq: '⪇',
	lneqq: '≨',
	lnsim: '⋦',
	loang: '⟬',
	loarr: '⇽',
	lobrk: '⟦',
	longleftarrow: '⟵',
	longleftrightarrow: '⟷',
	longmapsto: '⟼',
	longrightarrow: '⟶',
	looparrowleft: '↫',
	looparrowright: '↬',
	lopar: '⦅',
	lopf: '\uD835\uDD5D',
	loplus: '⨭',
	lotimes: '⨴',
	lowast: '∗',
	lowbar: '_',
	loz: '◊',
	lozenge: '◊',
	lozf: '⧫',
	lpar: '(',
	lparlt: '⦓',
	lrarr: '⇆',
	lrcorner: '⌟',
	lrhar: '⇋',
	lrhard: '⥭',
	lrm: '‎',
	lrtri: '⊿',
	lsaquo: '‹',
	lscr: '\uD835\uDCC1',
	lsh: '↰',
	lsim: '≲',
	lsime: '⪍',
	lsimg: '⪏',
	lsqb: '[',
	lsquo: '‘',
	lsquor: '‚',
	lstrok: 'ł',
	lt: '<',
	ltcc: '⪦',
	ltcir: '⩹',
	ltdot: '⋖',
	lthree: '⋋',
	ltimes: '⋉',
	ltlarr: '⥶',
	ltquest: '⩻',
	ltrPar: '⦖',
	ltri: '◃',
	ltrie: '⊴',
	ltrif: '◂',
	lurdshar: '⥊',
	luruhar: '⥦',
	lvertneqq: '≨︀',
	lvnE: '≨︀',
	mDDot: '∺',
	macr: '¯',
	male: '♂',
	malt: '✠',
	maltese: '✠',
	map: '↦',
	mapsto: '↦',
	mapstodown: '↧',
	mapstoleft: '↤',
	mapstoup: '↥',
	marker: '▮',
	mcomma: '⨩',
	mcy: 'м',
	mdash: '—',
	measuredangle: '∡',
	mfr: '\uD835\uDD2A',
	mho: '℧',
	micro: 'µ',
	mid: '∣',
	midast: '*',
	midcir: '⫰',
	middot: '·',
	minus: '−',
	minusb: '⊟',
	minusd: '∸',
	minusdu: '⨪',
	mlcp: '⫛',
	mldr: '…',
	mnplus: '∓',
	models: '⊧',
	mopf: '\uD835\uDD5E',
	mp: '∓',
	mscr: '\uD835\uDCC2',
	mstpos: '∾',
	mu: 'μ',
	multimap: '⊸',
	mumap: '⊸',
	nGg: '⋙̸',
	nGt: '≫⃒',
	nGtv: '≫̸',
	nLeftarrow: '⇍',
	nLeftrightarrow: '⇎',
	nLl: '⋘̸',
	nLt: '≪⃒',
	nLtv: '≪̸',
	nRightarrow: '⇏',
	nVDash: '⊯',
	nVdash: '⊮',
	nabla: '∇',
	nacute: 'ń',
	nang: '∠⃒',
	nap: '≉',
	napE: '⩰̸',
	napid: '≋̸',
	napos: 'ŉ',
	napprox: '≉',
	natur: '♮',
	natural: '♮',
	naturals: 'ℕ',
	nbsp: ' ',
	nbump: '≎̸',
	nbumpe: '≏̸',
	ncap: '⩃',
	ncaron: 'ň',
	ncedil: 'ņ',
	ncong: '≇',
	ncongdot: '⩭̸',
	ncup: '⩂',
	ncy: 'н',
	ndash: '–',
	ne: '≠',
	neArr: '⇗',
	nearhk: '⤤',
	nearr: '↗',
	nearrow: '↗',
	nedot: '≐̸',
	nequiv: '≢',
	nesear: '⤨',
	nesim: '≂̸',
	nexist: '∄',
	nexists: '∄',
	nfr: '\uD835\uDD2B',
	ngE: '≧̸',
	nge: '≱',
	ngeq: '≱',
	ngeqq: '≧̸',
	ngeqslant: '⩾̸',
	nges: '⩾̸',
	ngsim: '≵',
	ngt: '≯',
	ngtr: '≯',
	nhArr: '⇎',
	nharr: '↮',
	nhpar: '⫲',
	ni: '∋',
	nis: '⋼',
	nisd: '⋺',
	niv: '∋',
	njcy: 'њ',
	nlArr: '⇍',
	nlE: '≦̸',
	nlarr: '↚',
	nldr: '‥',
	nle: '≰',
	nleftarrow: '↚',
	nleftrightarrow: '↮',
	nleq: '≰',
	nleqq: '≦̸',
	nleqslant: '⩽̸',
	nles: '⩽̸',
	nless: '≮',
	nlsim: '≴',
	nlt: '≮',
	nltri: '⋪',
	nltrie: '⋬',
	nmid: '∤',
	nopf: '\uD835\uDD5F',
	not: '¬',
	notin: '∉',
	notinE: '⋹̸',
	notindot: '⋵̸',
	notinva: '∉',
	notinvb: '⋷',
	notinvc: '⋶',
	notni: '∌',
	notniva: '∌',
	notnivb: '⋾',
	notnivc: '⋽',
	npar: '∦',
	nparallel: '∦',
	nparsl: '⫽⃥',
	npart: '∂̸',
	npolint: '⨔',
	npr: '⊀',
	nprcue: '⋠',
	npre: '⪯̸',
	nprec: '⊀',
	npreceq: '⪯̸',
	nrArr: '⇏',
	nrarr: '↛',
	nrarrc: '⤳̸',
	nrarrw: '↝̸',
	nrightarrow: '↛',
	nrtri: '⋫',
	nrtrie: '⋭',
	nsc: '⊁',
	nsccue: '⋡',
	nsce: '⪰̸',
	nscr: '\uD835\uDCC3',
	nshortmid: '∤',
	nshortparallel: '∦',
	nsim: '≁',
	nsime: '≄',
	nsimeq: '≄',
	nsmid: '∤',
	nspar: '∦',
	nsqsube: '⋢',
	nsqsupe: '⋣',
	nsub: '⊄',
	nsubE: '⫅̸',
	nsube: '⊈',
	nsubset: '⊂⃒',
	nsubseteq: '⊈',
	nsubseteqq: '⫅̸',
	nsucc: '⊁',
	nsucceq: '⪰̸',
	nsup: '⊅',
	nsupE: '⫆̸',
	nsupe: '⊉',
	nsupset: '⊃⃒',
	nsupseteq: '⊉',
	nsupseteqq: '⫆̸',
	ntgl: '≹',
	ntilde: 'ñ',
	ntlg: '≸',
	ntriangleleft: '⋪',
	ntrianglelefteq: '⋬',
	ntriangleright: '⋫',
	ntrianglerighteq: '⋭',
	nu: 'ν',
	num: '#',
	numero: '№',
	numsp: ' ',
	nvDash: '⊭',
	nvHarr: '⤄',
	nvap: '≍⃒',
	nvdash: '⊬',
	nvge: '≥⃒',
	nvgt: '>⃒',
	nvinfin: '⧞',
	nvlArr: '⤂',
	nvle: '≤⃒',
	nvlt: '<⃒',
	nvltrie: '⊴⃒',
	nvrArr: '⤃',
	nvrtrie: '⊵⃒',
	nvsim: '∼⃒',
	nwArr: '⇖',
	nwarhk: '⤣',
	nwarr: '↖',
	nwarrow: '↖',
	nwnear: '⤧',
	oS: 'Ⓢ',
	oacute: 'ó',
	oast: '⊛',
	ocir: '⊚',
	ocirc: 'ô',
	ocy: 'о',
	odash: '⊝',
	odblac: 'ő',
	odiv: '⨸',
	odot: '⊙',
	odsold: '⦼',
	oelig: 'œ',
	ofcir: '⦿',
	ofr: '\uD835\uDD2C',
	ogon: '˛',
	ograve: 'ò',
	ogt: '⧁',
	ohbar: '⦵',
	ohm: 'Ω',
	oint: '∮',
	olarr: '↺',
	olcir: '⦾',
	olcross: '⦻',
	oline: '‾',
	olt: '⧀',
	omacr: 'ō',
	omega: 'ω',
	omicron: 'ο',
	omid: '⦶',
	ominus: '⊖',
	oopf: '\uD835\uDD60',
	opar: '⦷',
	operp: '⦹',
	oplus: '⊕',
	or: '∨',
	orarr: '↻',
	ord: '⩝',
	order: 'ℴ',
	orderof: 'ℴ',
	ordf: 'ª',
	ordm: 'º',
	origof: '⊶',
	oror: '⩖',
	orslope: '⩗',
	orv: '⩛',
	oscr: 'ℴ',
	oslash: 'ø',
	osol: '⊘',
	otilde: 'õ',
	otimes: '⊗',
	otimesas: '⨶',
	ouml: 'ö',
	ovbar: '⌽',
	par: '∥',
	para: '¶',
	parallel: '∥',
	parsim: '⫳',
	parsl: '⫽',
	part: '∂',
	pcy: 'п',
	percnt: '%',
	period: '.',
	permil: '‰',
	perp: '⊥',
	pertenk: '‱',
	pfr: '\uD835\uDD2D',
	phi: 'φ',
	phiv: 'ϕ',
	phmmat: 'ℳ',
	phone: '☎',
	pi: 'π',
	pitchfork: '⋔',
	piv: 'ϖ',
	planck: 'ℏ',
	planckh: 'ℎ',
	plankv: 'ℏ',
	plus: '+',
	plusacir: '⨣',
	plusb: '⊞',
	pluscir: '⨢',
	plusdo: '∔',
	plusdu: '⨥',
	pluse: '⩲',
	plusmn: '±',
	plussim: '⨦',
	plustwo: '⨧',
	pm: '±',
	pointint: '⨕',
	popf: '\uD835\uDD61',
	pound: '£',
	pr: '≺',
	prE: '⪳',
	prap: '⪷',
	prcue: '≼',
	pre: '⪯',
	prec: '≺',
	precapprox: '⪷',
	preccurlyeq: '≼',
	preceq: '⪯',
	precnapprox: '⪹',
	precneqq: '⪵',
	precnsim: '⋨',
	precsim: '≾',
	prime: '′',
	primes: 'ℙ',
	prnE: '⪵',
	prnap: '⪹',
	prnsim: '⋨',
	prod: '∏',
	profalar: '⌮',
	profline: '⌒',
	profsurf: '⌓',
	prop: '∝',
	propto: '∝',
	prsim: '≾',
	prurel: '⊰',
	pscr: '\uD835\uDCC5',
	psi: 'ψ',
	puncsp: ' ',
	qfr: '\uD835\uDD2E',
	qint: '⨌',
	qopf: '\uD835\uDD62',
	qprime: '⁗',
	qscr: '\uD835\uDCC6',
	quaternions: 'ℍ',
	quatint: '⨖',
	quest: '?',
	questeq: '≟',
	quot: '"',
	rAarr: '⇛',
	rArr: '⇒',
	rAtail: '⤜',
	rBarr: '⤏',
	rHar: '⥤',
	race: '∽̱',
	racute: 'ŕ',
	radic: '√',
	raemptyv: '⦳',
	rang: '⟩',
	rangd: '⦒',
	range: '⦥',
	rangle: '⟩',
	raquo: '»',
	rarr: '→',
	rarrap: '⥵',
	rarrb: '⇥',
	rarrbfs: '⤠',
	rarrc: '⤳',
	rarrfs: '⤞',
	rarrhk: '↪',
	rarrlp: '↬',
	rarrpl: '⥅',
	rarrsim: '⥴',
	rarrtl: '↣',
	rarrw: '↝',
	ratail: '⤚',
	ratio: '∶',
	rationals: 'ℚ',
	rbarr: '⤍',
	rbbrk: '❳',
	rbrace: '}',
	rbrack: ']',
	rbrke: '⦌',
	rbrksld: '⦎',
	rbrkslu: '⦐',
	rcaron: 'ř',
	rcedil: 'ŗ',
	rceil: '⌉',
	rcub: '}',
	rcy: 'р',
	rdca: '⤷',
	rdldhar: '⥩',
	rdquo: '”',
	rdquor: '”',
	rdsh: '↳',
	real: 'ℜ',
	realine: 'ℛ',
	realpart: 'ℜ',
	reals: 'ℝ',
	rect: '▭',
	reg: '®',
	rfisht: '⥽',
	rfloor: '⌋',
	rfr: '\uD835\uDD2F',
	rhard: '⇁',
	rharu: '⇀',
	rharul: '⥬',
	rho: 'ρ',
	rhov: 'ϱ',
	rightarrow: '→',
	rightarrowtail: '↣',
	rightharpoondown: '⇁',
	rightharpoonup: '⇀',
	rightleftarrows: '⇄',
	rightleftharpoons: '⇌',
	rightrightarrows: '⇉',
	rightsquigarrow: '↝',
	rightthreetimes: '⋌',
	ring: '˚',
	risingdotseq: '≓',
	rlarr: '⇄',
	rlhar: '⇌',
	rlm: '‏',
	rmoust: '⎱',
	rmoustache: '⎱',
	rnmid: '⫮',
	roang: '⟭',
	roarr: '⇾',
	robrk: '⟧',
	ropar: '⦆',
	ropf: '\uD835\uDD63',
	roplus: '⨮',
	rotimes: '⨵',
	rpar: ')',
	rpargt: '⦔',
	rppolint: '⨒',
	rrarr: '⇉',
	rsaquo: '›',
	rscr: '\uD835\uDCC7',
	rsh: '↱',
	rsqb: ']',
	rsquo: '’',
	rsquor: '’',
	rthree: '⋌',
	rtimes: '⋊',
	rtri: '▹',
	rtrie: '⊵',
	rtrif: '▸',
	rtriltri: '⧎',
	ruluhar: '⥨',
	rx: '℞',
	sacute: 'ś',
	sbquo: '‚',
	sc: '≻',
	scE: '⪴',
	scap: '⪸',
	scaron: 'š',
	sccue: '≽',
	sce: '⪰',
	scedil: 'ş',
	scirc: 'ŝ',
	scnE: '⪶',
	scnap: '⪺',
	scnsim: '⋩',
	scpolint: '⨓',
	scsim: '≿',
	scy: 'с',
	sdot: '⋅',
	sdotb: '⊡',
	sdote: '⩦',
	seArr: '⇘',
	searhk: '⤥',
	searr: '↘',
	searrow: '↘',
	sect: '§',
	semi: ';',
	seswar: '⤩',
	setminus: '∖',
	setmn: '∖',
	sext: '✶',
	sfr: '\uD835\uDD30',
	sfrown: '⌢',
	sharp: '♯',
	shchcy: 'щ',
	shcy: 'ш',
	shortmid: '∣',
	shortparallel: '∥',
	shy: '­',
	sigma: 'σ',
	sigmaf: 'ς',
	sigmav: 'ς',
	sim: '∼',
	simdot: '⩪',
	sime: '≃',
	simeq: '≃',
	simg: '⪞',
	simgE: '⪠',
	siml: '⪝',
	simlE: '⪟',
	simne: '≆',
	simplus: '⨤',
	simrarr: '⥲',
	slarr: '←',
	smallsetminus: '∖',
	smashp: '⨳',
	smeparsl: '⧤',
	smid: '∣',
	smile: '⌣',
	smt: '⪪',
	smte: '⪬',
	smtes: '⪬︀',
	softcy: 'ь',
	sol: '/',
	solb: '⧄',
	solbar: '⌿',
	sopf: '\uD835\uDD64',
	spades: '♠',
	spadesuit: '♠',
	spar: '∥',
	sqcap: '⊓',
	sqcaps: '⊓︀',
	sqcup: '⊔',
	sqcups: '⊔︀',
	sqsub: '⊏',
	sqsube: '⊑',
	sqsubset: '⊏',
	sqsubseteq: '⊑',
	sqsup: '⊐',
	sqsupe: '⊒',
	sqsupset: '⊐',
	sqsupseteq: '⊒',
	squ: '□',
	square: '□',
	squarf: '▪',
	squf: '▪',
	srarr: '→',
	sscr: '\uD835\uDCC8',
	ssetmn: '∖',
	ssmile: '⌣',
	sstarf: '⋆',
	star: '☆',
	starf: '★',
	straightepsilon: 'ϵ',
	straightphi: 'ϕ',
	strns: '¯',
	sub: '⊂',
	subE: '⫅',
	subdot: '⪽',
	sube: '⊆',
	subedot: '⫃',
	submult: '⫁',
	subnE: '⫋',
	subne: '⊊',
	subplus: '⪿',
	subrarr: '⥹',
	subset: '⊂',
	subseteq: '⊆',
	subseteqq: '⫅',
	subsetneq: '⊊',
	subsetneqq: '⫋',
	subsim: '⫇',
	subsub: '⫕',
	subsup: '⫓',
	succ: '≻',
	succapprox: '⪸',
	succcurlyeq: '≽',
	succeq: '⪰',
	succnapprox: '⪺',
	succneqq: '⪶',
	succnsim: '⋩',
	succsim: '≿',
	sum: '∑',
	sung: '♪',
	sup1: '¹',
	sup2: '²',
	sup3: '³',
	sup: '⊃',
	supE: '⫆',
	supdot: '⪾',
	supdsub: '⫘',
	supe: '⊇',
	supedot: '⫄',
	suphsol: '⟉',
	suphsub: '⫗',
	suplarr: '⥻',
	supmult: '⫂',
	supnE: '⫌',
	supne: '⊋',
	supplus: '⫀',
	supset: '⊃',
	supseteq: '⊇',
	supseteqq: '⫆',
	supsetneq: '⊋',
	supsetneqq: '⫌',
	supsim: '⫈',
	supsub: '⫔',
	supsup: '⫖',
	swArr: '⇙',
	swarhk: '⤦',
	swarr: '↙',
	swarrow: '↙',
	swnwar: '⤪',
	szlig: 'ß',
	target: '⌖',
	tau: 'τ',
	tbrk: '⎴',
	tcaron: 'ť',
	tcedil: 'ţ',
	tcy: 'т',
	tdot: '⃛',
	telrec: '⌕',
	tfr: '\uD835\uDD31',
	there4: '∴',
	therefore: '∴',
	theta: 'θ',
	thetasym: 'ϑ',
	thetav: 'ϑ',
	thickapprox: '≈',
	thicksim: '∼',
	thinsp: ' ',
	thkap: '≈',
	thksim: '∼',
	thorn: 'þ',
	tilde: '˜',
	times: '×',
	timesb: '⊠',
	timesbar: '⨱',
	timesd: '⨰',
	tint: '∭',
	toea: '⤨',
	top: '⊤',
	topbot: '⌶',
	topcir: '⫱',
	topf: '\uD835\uDD65',
	topfork: '⫚',
	tosa: '⤩',
	tprime: '‴',
	trade: '™',
	triangle: '▵',
	triangledown: '▿',
	triangleleft: '◃',
	trianglelefteq: '⊴',
	triangleq: '≜',
	triangleright: '▹',
	trianglerighteq: '⊵',
	tridot: '◬',
	trie: '≜',
	triminus: '⨺',
	triplus: '⨹',
	trisb: '⧍',
	tritime: '⨻',
	trpezium: '⏢',
	tscr: '\uD835\uDCC9',
	tscy: 'ц',
	tshcy: 'ћ',
	tstrok: 'ŧ',
	twixt: '≬',
	twoheadleftarrow: '↞',
	twoheadrightarrow: '↠',
	uArr: '⇑',
	uHar: '⥣',
	uacute: 'ú',
	uarr: '↑',
	ubrcy: 'ў',
	ubreve: 'ŭ',
	ucirc: 'û',
	ucy: 'у',
	udarr: '⇅',
	udblac: 'ű',
	udhar: '⥮',
	ufisht: '⥾',
	ufr: '\uD835\uDD32',
	ugrave: 'ù',
	uharl: '↿',
	uharr: '↾',
	uhblk: '▀',
	ulcorn: '⌜',
	ulcorner: '⌜',
	ulcrop: '⌏',
	ultri: '◸',
	umacr: 'ū',
	uml: '¨',
	uogon: 'ų',
	uopf: '\uD835\uDD66',
	uparrow: '↑',
	updownarrow: '↕',
	upharpoonleft: '↿',
	upharpoonright: '↾',
	uplus: '⊎',
	upsi: 'υ',
	upsih: 'ϒ',
	upsilon: 'υ',
	upuparrows: '⇈',
	urcorn: '⌝',
	urcorner: '⌝',
	urcrop: '⌎',
	uring: 'ů',
	urtri: '◹',
	uscr: '\uD835\uDCCA',
	utdot: '⋰',
	utilde: 'ũ',
	utri: '▵',
	utrif: '▴',
	uuarr: '⇈',
	uuml: 'ü',
	uwangle: '⦧',
	vArr: '⇕',
	vBar: '⫨',
	vBarv: '⫩',
	vDash: '⊨',
	vangrt: '⦜',
	varepsilon: 'ϵ',
	varkappa: 'ϰ',
	varnothing: '∅',
	varphi: 'ϕ',
	varpi: 'ϖ',
	varpropto: '∝',
	varr: '↕',
	varrho: 'ϱ',
	varsigma: 'ς',
	varsubsetneq: '⊊︀',
	varsubsetneqq: '⫋︀',
	varsupsetneq: '⊋︀',
	varsupsetneqq: '⫌︀',
	vartheta: 'ϑ',
	vartriangleleft: '⊲',
	vartriangleright: '⊳',
	vcy: 'в',
	vdash: '⊢',
	vee: '∨',
	veebar: '⊻',
	veeeq: '≚',
	vellip: '⋮',
	verbar: '|',
	vert: '|',
	vfr: '\uD835\uDD33',
	vltri: '⊲',
	vnsub: '⊂⃒',
	vnsup: '⊃⃒',
	vopf: '\uD835\uDD67',
	vprop: '∝',
	vrtri: '⊳',
	vscr: '\uD835\uDCCB',
	vsubnE: '⫋︀',
	vsubne: '⊊︀',
	vsupnE: '⫌︀',
	vsupne: '⊋︀',
	vzigzag: '⦚',
	wcirc: 'ŵ',
	wedbar: '⩟',
	wedge: '∧',
	wedgeq: '≙',
	weierp: '℘',
	wfr: '\uD835\uDD34',
	wopf: '\uD835\uDD68',
	wp: '℘',
	wr: '≀',
	wreath: '≀',
	wscr: '\uD835\uDCCC',
	xcap: '⋂',
	xcirc: '◯',
	xcup: '⋃',
	xdtri: '▽',
	xfr: '\uD835\uDD35',
	xhArr: '⟺',
	xharr: '⟷',
	xi: 'ξ',
	xlArr: '⟸',
	xlarr: '⟵',
	xmap: '⟼',
	xnis: '⋻',
	xodot: '⨀',
	xopf: '\uD835\uDD69',
	xoplus: '⨁',
	xotime: '⨂',
	xrArr: '⟹',
	xrarr: '⟶',
	xscr: '\uD835\uDCCD',
	xsqcup: '⨆',
	xuplus: '⨄',
	xutri: '△',
	xvee: '⋁',
	xwedge: '⋀',
	yacute: 'ý',
	yacy: 'я',
	ycirc: 'ŷ',
	ycy: 'ы',
	yen: '¥',
	yfr: '\uD835\uDD36',
	yicy: 'ї',
	yopf: '\uD835\uDD6A',
	yscr: '\uD835\uDCCE',
	yucy: 'ю',
	yuml: 'ÿ',
	zacute: 'ź',
	zcaron: 'ž',
	zcy: 'з',
	zdot: 'ż',
	zeetrf: 'ℨ',
	zeta: 'ζ',
	zfr: '\uD835\uDD37',
	zhcy: 'ж',
	zigrarr: '⇝',
	zopf: '\uD835\uDD6B',
	zscr: '\uD835\uDCCF',
	zwj: '‍',
	zwnj: '‌',
};
var rA = {}.hasOwnProperty;
function vr(e) {
	return rA.call(sc, e) ? sc[e] : !1;
}
var p = {
	carriageReturn: -5,
	lineFeed: -4,
	carriageReturnLineFeed: -3,
	horizontalTab: -2,
	virtualSpace: -1,
	eof: null,
	nul: 0,
	soh: 1,
	stx: 2,
	etx: 3,
	eot: 4,
	enq: 5,
	ack: 6,
	bel: 7,
	bs: 8,
	ht: 9,
	lf: 10,
	vt: 11,
	ff: 12,
	cr: 13,
	so: 14,
	si: 15,
	dle: 16,
	dc1: 17,
	dc2: 18,
	dc3: 19,
	dc4: 20,
	nak: 21,
	syn: 22,
	etb: 23,
	can: 24,
	em: 25,
	sub: 26,
	esc: 27,
	fs: 28,
	gs: 29,
	rs: 30,
	us: 31,
	space: 32,
	exclamationMark: 33,
	quotationMark: 34,
	numberSign: 35,
	dollarSign: 36,
	percentSign: 37,
	ampersand: 38,
	apostrophe: 39,
	leftParenthesis: 40,
	rightParenthesis: 41,
	asterisk: 42,
	plusSign: 43,
	comma: 44,
	dash: 45,
	dot: 46,
	slash: 47,
	digit0: 48,
	digit1: 49,
	digit2: 50,
	digit3: 51,
	digit4: 52,
	digit5: 53,
	digit6: 54,
	digit7: 55,
	digit8: 56,
	digit9: 57,
	colon: 58,
	semicolon: 59,
	lessThan: 60,
	equalsTo: 61,
	greaterThan: 62,
	questionMark: 63,
	atSign: 64,
	uppercaseA: 65,
	uppercaseB: 66,
	uppercaseC: 67,
	uppercaseD: 68,
	uppercaseE: 69,
	uppercaseF: 70,
	uppercaseG: 71,
	uppercaseH: 72,
	uppercaseI: 73,
	uppercaseJ: 74,
	uppercaseK: 75,
	uppercaseL: 76,
	uppercaseM: 77,
	uppercaseN: 78,
	uppercaseO: 79,
	uppercaseP: 80,
	uppercaseQ: 81,
	uppercaseR: 82,
	uppercaseS: 83,
	uppercaseT: 84,
	uppercaseU: 85,
	uppercaseV: 86,
	uppercaseW: 87,
	uppercaseX: 88,
	uppercaseY: 89,
	uppercaseZ: 90,
	leftSquareBracket: 91,
	backslash: 92,
	rightSquareBracket: 93,
	caret: 94,
	underscore: 95,
	graveAccent: 96,
	lowercaseA: 97,
	lowercaseB: 98,
	lowercaseC: 99,
	lowercaseD: 100,
	lowercaseE: 101,
	lowercaseF: 102,
	lowercaseG: 103,
	lowercaseH: 104,
	lowercaseI: 105,
	lowercaseJ: 106,
	lowercaseK: 107,
	lowercaseL: 108,
	lowercaseM: 109,
	lowercaseN: 110,
	lowercaseO: 111,
	lowercaseP: 112,
	lowercaseQ: 113,
	lowercaseR: 114,
	lowercaseS: 115,
	lowercaseT: 116,
	lowercaseU: 117,
	lowercaseV: 118,
	lowercaseW: 119,
	lowercaseX: 120,
	lowercaseY: 121,
	lowercaseZ: 122,
	leftCurlyBrace: 123,
	verticalBar: 124,
	rightCurlyBrace: 125,
	tilde: 126,
	del: 127,
	byteOrderMarker: 65279,
	replacementCharacter: 65533,
};
var P = {
	attentionSideAfter: 2,
	attentionSideBefore: 1,
	atxHeadingOpeningFenceSizeMax: 6,
	autolinkDomainSizeMax: 63,
	autolinkSchemeSizeMax: 32,
	cdataOpeningString: 'CDATA[',
	characterGroupPunctuation: 2,
	characterGroupWhitespace: 1,
	characterReferenceDecimalSizeMax: 7,
	characterReferenceHexadecimalSizeMax: 6,
	characterReferenceNamedSizeMax: 31,
	codeFencedSequenceSizeMin: 3,
	contentTypeContent: 'content',
	contentTypeDocument: 'document',
	contentTypeFlow: 'flow',
	contentTypeString: 'string',
	contentTypeText: 'text',
	hardBreakPrefixSizeMin: 2,
	htmlBasic: 6,
	htmlCdata: 5,
	htmlComment: 2,
	htmlComplete: 7,
	htmlDeclaration: 4,
	htmlInstruction: 3,
	htmlRawSizeMax: 8,
	htmlRaw: 1,
	linkResourceDestinationBalanceMax: 32,
	linkReferenceSizeMax: 999,
	listItemValueSizeMax: 10,
	numericBaseDecimal: 10,
	numericBaseHexadecimal: 16,
	tabSize: 4,
	thematicBreakMarkerCountMin: 3,
	v8MaxSafeChunkSize: 1e4,
};
var m = {
	data: 'data',
	whitespace: 'whitespace',
	lineEnding: 'lineEnding',
	lineEndingBlank: 'lineEndingBlank',
	linePrefix: 'linePrefix',
	lineSuffix: 'lineSuffix',
	atxHeading: 'atxHeading',
	atxHeadingSequence: 'atxHeadingSequence',
	atxHeadingText: 'atxHeadingText',
	autolink: 'autolink',
	autolinkEmail: 'autolinkEmail',
	autolinkMarker: 'autolinkMarker',
	autolinkProtocol: 'autolinkProtocol',
	characterEscape: 'characterEscape',
	characterEscapeValue: 'characterEscapeValue',
	characterReference: 'characterReference',
	characterReferenceMarker: 'characterReferenceMarker',
	characterReferenceMarkerNumeric: 'characterReferenceMarkerNumeric',
	characterReferenceMarkerHexadecimal: 'characterReferenceMarkerHexadecimal',
	characterReferenceValue: 'characterReferenceValue',
	codeFenced: 'codeFenced',
	codeFencedFence: 'codeFencedFence',
	codeFencedFenceSequence: 'codeFencedFenceSequence',
	codeFencedFenceInfo: 'codeFencedFenceInfo',
	codeFencedFenceMeta: 'codeFencedFenceMeta',
	codeFlowValue: 'codeFlowValue',
	codeIndented: 'codeIndented',
	codeText: 'codeText',
	codeTextData: 'codeTextData',
	codeTextPadding: 'codeTextPadding',
	codeTextSequence: 'codeTextSequence',
	content: 'content',
	definition: 'definition',
	definitionDestination: 'definitionDestination',
	definitionDestinationLiteral: 'definitionDestinationLiteral',
	definitionDestinationLiteralMarker: 'definitionDestinationLiteralMarker',
	definitionDestinationRaw: 'definitionDestinationRaw',
	definitionDestinationString: 'definitionDestinationString',
	definitionLabel: 'definitionLabel',
	definitionLabelMarker: 'definitionLabelMarker',
	definitionLabelString: 'definitionLabelString',
	definitionMarker: 'definitionMarker',
	definitionTitle: 'definitionTitle',
	definitionTitleMarker: 'definitionTitleMarker',
	definitionTitleString: 'definitionTitleString',
	emphasis: 'emphasis',
	emphasisSequence: 'emphasisSequence',
	emphasisText: 'emphasisText',
	escapeMarker: 'escapeMarker',
	hardBreakEscape: 'hardBreakEscape',
	hardBreakTrailing: 'hardBreakTrailing',
	htmlFlow: 'htmlFlow',
	htmlFlowData: 'htmlFlowData',
	htmlText: 'htmlText',
	htmlTextData: 'htmlTextData',
	image: 'image',
	label: 'label',
	labelText: 'labelText',
	labelLink: 'labelLink',
	labelImage: 'labelImage',
	labelMarker: 'labelMarker',
	labelImageMarker: 'labelImageMarker',
	labelEnd: 'labelEnd',
	link: 'link',
	paragraph: 'paragraph',
	reference: 'reference',
	referenceMarker: 'referenceMarker',
	referenceString: 'referenceString',
	resource: 'resource',
	resourceDestination: 'resourceDestination',
	resourceDestinationLiteral: 'resourceDestinationLiteral',
	resourceDestinationLiteralMarker: 'resourceDestinationLiteralMarker',
	resourceDestinationRaw: 'resourceDestinationRaw',
	resourceDestinationString: 'resourceDestinationString',
	resourceMarker: 'resourceMarker',
	resourceTitle: 'resourceTitle',
	resourceTitleMarker: 'resourceTitleMarker',
	resourceTitleString: 'resourceTitleString',
	setextHeading: 'setextHeading',
	setextHeadingText: 'setextHeadingText',
	setextHeadingLine: 'setextHeadingLine',
	setextHeadingLineSequence: 'setextHeadingLineSequence',
	strong: 'strong',
	strongSequence: 'strongSequence',
	strongText: 'strongText',
	thematicBreak: 'thematicBreak',
	thematicBreakSequence: 'thematicBreakSequence',
	blockQuote: 'blockQuote',
	blockQuotePrefix: 'blockQuotePrefix',
	blockQuoteMarker: 'blockQuoteMarker',
	blockQuotePrefixWhitespace: 'blockQuotePrefixWhitespace',
	listOrdered: 'listOrdered',
	listUnordered: 'listUnordered',
	listItemIndent: 'listItemIndent',
	listItemMarker: 'listItemMarker',
	listItemPrefix: 'listItemPrefix',
	listItemPrefixWhitespace: 'listItemPrefixWhitespace',
	listItemValue: 'listItemValue',
	chunkDocument: 'chunkDocument',
	chunkContent: 'chunkContent',
	chunkFlow: 'chunkFlow',
	chunkText: 'chunkText',
	chunkString: 'chunkString',
};
var Ee = {
	ht: '\t',
	lf: `
`,
	cr: '\r',
	space: ' ',
	exclamationMark: '!',
	quotationMark: '"',
	numberSign: '#',
	dollarSign: '$',
	percentSign: '%',
	ampersand: '&',
	apostrophe: "'",
	leftParenthesis: '(',
	rightParenthesis: ')',
	asterisk: '*',
	plusSign: '+',
	comma: ',',
	dash: '-',
	dot: '.',
	slash: '/',
	digit0: '0',
	digit1: '1',
	digit2: '2',
	digit3: '3',
	digit4: '4',
	digit5: '5',
	digit6: '6',
	digit7: '7',
	digit8: '8',
	digit9: '9',
	colon: ':',
	semicolon: ';',
	lessThan: '<',
	equalsTo: '=',
	greaterThan: '>',
	questionMark: '?',
	atSign: '@',
	uppercaseA: 'A',
	uppercaseB: 'B',
	uppercaseC: 'C',
	uppercaseD: 'D',
	uppercaseE: 'E',
	uppercaseF: 'F',
	uppercaseG: 'G',
	uppercaseH: 'H',
	uppercaseI: 'I',
	uppercaseJ: 'J',
	uppercaseK: 'K',
	uppercaseL: 'L',
	uppercaseM: 'M',
	uppercaseN: 'N',
	uppercaseO: 'O',
	uppercaseP: 'P',
	uppercaseQ: 'Q',
	uppercaseR: 'R',
	uppercaseS: 'S',
	uppercaseT: 'T',
	uppercaseU: 'U',
	uppercaseV: 'V',
	uppercaseW: 'W',
	uppercaseX: 'X',
	uppercaseY: 'Y',
	uppercaseZ: 'Z',
	leftSquareBracket: '[',
	backslash: '\\',
	rightSquareBracket: ']',
	caret: '^',
	underscore: '_',
	graveAccent: '`',
	lowercaseA: 'a',
	lowercaseB: 'b',
	lowercaseC: 'c',
	lowercaseD: 'd',
	lowercaseE: 'e',
	lowercaseF: 'f',
	lowercaseG: 'g',
	lowercaseH: 'h',
	lowercaseI: 'i',
	lowercaseJ: 'j',
	lowercaseK: 'k',
	lowercaseL: 'l',
	lowercaseM: 'm',
	lowercaseN: 'n',
	lowercaseO: 'o',
	lowercaseP: 'p',
	lowercaseQ: 'q',
	lowercaseR: 'r',
	lowercaseS: 's',
	lowercaseT: 't',
	lowercaseU: 'u',
	lowercaseV: 'v',
	lowercaseW: 'w',
	lowercaseX: 'x',
	lowercaseY: 'y',
	lowercaseZ: 'z',
	leftCurlyBrace: '{',
	verticalBar: '|',
	rightCurlyBrace: '}',
	tilde: '~',
	replacementCharacter: '�',
};
function he(e, t, r, n) {
	let i = e.length, o = 0, s;
	if (t < 0) t = -t > i ? 0 : i + t;
	else t = t > i ? i : t;
	if (r = r > 0 ? r : 0, n.length < P.v8MaxSafeChunkSize) s = Array.from(n), s.unshift(t, r), e.splice(...s);
	else {
		if (r) e.splice(t, r);
		while (o < n.length) {
			s = n.slice(o, o + P.v8MaxSafeChunkSize),
				s.unshift(t, 0),
				e.splice(...s),
				o += P.v8MaxSafeChunkSize,
				t += P.v8MaxSafeChunkSize;
		}
	}
}
function we(e, t) {
	if (e.length > 0) return he(e, e.length, 0, t), e;
	return t;
}
var Tg = {}.hasOwnProperty;
function uo(e) {
	let t = {}, r = -1;
	while (++r < e.length) nA(t, e[r]);
	return t;
}
function nA(e, t) {
	let r;
	for (r in t) {
		let i = (Tg.call(e, r) ? e[r] : void 0) || (e[r] = {}), o = t[r], s;
		if (o) {
			for (s in o) {
				if (!Tg.call(i, s)) i[s] = [];
				let a = o[s];
				iA(i[s], Array.isArray(a) ? a : a ? [a] : []);
			}
		}
	}
}
function iA(e, t) {
	let r = -1, n = [];
	while (++r < t.length) (t[r].add === 'after' ? e : n).push(t[r]);
	he(e, 0, 0, n);
}
function lo(e, t) {
	let r = Number.parseInt(e, t);
	if (
		r < p.ht || r === p.vt || r > p.cr && r < p.space || r > p.tilde && r < 160 || r > 55295 && r < 57344
		|| r > 64975 && r < 65008 || (r & 65535) === 65535 || (r & 65535) === 65534 || r > 1114111
	) return Ee.replacementCharacter;
	return String.fromCodePoint(r);
}
function ye(e) {
	return e.replace(/[\t\n\r ]+/g, Ee.space).replace(/^ | $/g, '').toLowerCase().toUpperCase();
}
var oe = _t(/[A-Za-z]/), ae = _t(/[\dA-Za-z]/), Ag = _t(/[#-'*+\--9=?A-Z^-~]/);
function Vt(e) {
	return e !== null && (e < p.space || e === p.del);
}
var wn = _t(/\d/), Eg = _t(/[\dA-Fa-f]/), fo = _t(/[!-/:-@[-`{-~]/);
function N(e) {
	return e !== null && e < p.horizontalTab;
}
function G(e) {
	return e !== null && (e < p.nul || e === p.space);
}
function R(e) {
	return e === p.horizontalTab || e === p.virtualSpace || e === p.space;
}
var Kt = _t(/\p{P}|\p{S}/u), Qe = _t(/\s/);
function _t(e) {
	return t;
	function t(r) {
		return r !== null && r > -1 && e.test(String.fromCharCode(r));
	}
}
function j(e, t, r, n) {
	let i = n ? n - 1 : 1 / 0, o = 0;
	return s;
	function s(c) {
		if (R(c)) return e.enter(r), a(c);
		return t(c);
	}
	function a(c) {
		if (R(c) && o++ < i) return e.consume(c), a;
		return e.exit(r), t(c);
	}
}
function ac(e, t, r, n, i, o) {
	let s = 0;
	return a;
	function a(l) {
		if (o > 0 && R(l)) return e.enter(n), c(l);
		return u(l);
	}
	function c(l) {
		if (R(l) && s < o) return e.consume(l), s++, c;
		return e.exit(n), u(l);
	}
	function u(l) {
		return s >= i ? t(l) : r(l);
	}
}
var Ig = { tokenize: oA };
function oA(e) {
	let t = e.attempt(this.parser.constructs.contentInitial, n, i), r;
	return t;
	function n(a) {
		if (b(a === p.eof || N(a), 'expected eol or eof'), a === p.eof) {
			e.consume(a);
			return;
		}
		return e.enter(m.lineEnding), e.consume(a), e.exit(m.lineEnding), j(e, t, m.linePrefix);
	}
	function i(a) {
		return b(a !== p.eof && !N(a), 'expected anything other than a line ending or EOF'), e.enter(m.paragraph), o(a);
	}
	function o(a) {
		let c = e.enter(m.chunkText, { contentType: P.contentTypeText, previous: r });
		if (r) r.next = c;
		return r = c, s(a);
	}
	function s(a) {
		if (a === p.eof) {
			e.exit(m.chunkText), e.exit(m.paragraph), e.consume(a);
			return;
		}
		if (N(a)) return e.consume(a), e.exit(m.chunkText), o;
		return e.consume(a), s;
	}
}
class Ct {
	constructor() {
		this.index = new Map(), this.map = [];
	}
	add(e, t, r) {
		Pg(this, e, t, r, !1);
	}
	addBefore(e, t, r) {
		Pg(this, e, t, r, !0);
	}
	consume(e) {
		if (
			this.map.sort(function(i, o) {
				return i[0] - o[0];
			}), this.map.length === 0
		) return;
		let t = this.map.length, r = [];
		while (t > 0) t -= 1, r.push(e.slice(this.map[t][0] + this.map[t][1]), this.map[t][2]), e.length = this.map[t][0];
		r.push(e.slice()), e.length = 0;
		let n = r.pop();
		while (n) {
			for (let i of n) e.push(i);
			n = r.pop();
		}
		this.map.length = 0, this.index.clear();
	}
}
function Pg(e, t, r, n, i) {
	if (r === 0 && n.length === 0) return;
	let o = e.index.get(t);
	if (o) {
		if (o[1] += r, i) n.push(...o[2]), o[2] = n;
		else o[2].push(...n);
		return;
	}
	let s = [t, r, n];
	e.map.push(s), e.index.set(t, s);
}
var $g = { tokenize: sA }, Og = { tokenize: aA };
function sA(e) {
	let t = this, r = [], n = 0, i, o, s;
	return a;
	function a(_) {
		if (n < r.length) {
			let O = r[n];
			return t.containerState = O[1],
				b(O[0].continuation, 'expected `continuation` to be defined on container construct'),
				e.attempt(O[0].continuation, c, u)(_);
		}
		return u(_);
	}
	function c(_) {
		if (
			b(t.containerState, 'expected `containerState` to be defined after continuation'),
				n++,
				t.containerState._closeFlow
		) {
			if (t.containerState._closeFlow = void 0, i) z();
			let O = t.events.length, I = O, v;
			while (I--) {
				if (t.events[I][0] === 'exit' && t.events[I][1].type === m.chunkFlow) {
					v = t.events[I][1].end;
					break;
				}
			}
			b(v, 'could not find previous flow chunk'), k(n);
			let q = O;
			while (q < t.events.length) t.events[q][1].end = { ...v }, q++;
			let L = new Ct();
			return L.add(I + 1, 0, t.events.slice(O)), L.add(O, q - O, []), L.consume(t.events), u(_);
		}
		return a(_);
	}
	function u(_) {
		if (n === r.length) {
			if (!i) return h(_);
			if (i.currentConstruct && i.currentConstruct.concrete) return g(_);
			t.interrupt = Boolean(i.currentConstruct && !i._gfmTableDynamicInterruptHack);
		}
		return t.containerState = {}, e.check(Og, l, f)(_);
	}
	function l(_) {
		if (i) z();
		return k(n), h(_);
	}
	function f(_) {
		return t.parser.lazy[t.now().line] = n !== r.length, s = t.now().offset, g(_);
	}
	function h(_) {
		return t.containerState = {}, e.attempt(Og, d, g)(_);
	}
	function d(_) {
		return b(t.currentConstruct, 'expected `currentConstruct` to be defined on tokenizer'),
			b(t.containerState, 'expected `containerState` to be defined on tokenizer'),
			n++,
			r.push([t.currentConstruct, t.containerState]),
			h(_);
	}
	function g(_) {
		if (_ === p.eof) {
			if (i) z();
			k(0), e.consume(_);
			return;
		}
		return i = i || t.parser.flow(t.now()),
			e.enter(m.chunkFlow, { _tokenizer: i, contentType: P.contentTypeFlow, previous: o }),
			y(_);
	}
	function y(_) {
		if (_ === p.eof) {
			x(e.exit(m.chunkFlow), !0), k(0), e.consume(_);
			return;
		}
		if (N(_)) return e.consume(_), x(e.exit(m.chunkFlow)), n = 0, t.interrupt = void 0, a;
		return e.consume(_), y;
	}
	function x(_, O) {
		b(i, 'expected `childFlow` to be defined when continuing');
		let I = t.sliceStream(_);
		if (O) I.push(null);
		if (_.previous = o, o) o.next = _;
		if (o = _, i.defineSkip(_.start), i.write(I), t.parser.lazy[_.start.line]) {
			let v = i.events.length;
			while (v--) if (i.events[v][1].start.offset < s && (!i.events[v][1].end || i.events[v][1].end.offset > s)) return;
			let q = t.events.length, L = q, U, C;
			while (L--) {
				if (t.events[L][0] === 'exit' && t.events[L][1].type === m.chunkFlow) {
					if (U) {
						C = t.events[L][1].end;
						break;
					}
					U = !0;
				}
			}
			b(C, 'could not find previous flow chunk'), k(n), v = q;
			while (v < t.events.length) t.events[v][1].end = { ...C }, v++;
			let J = new Ct();
			J.add(L + 1, 0, t.events.slice(q)), J.add(q, v - q, []), J.consume(t.events);
		}
	}
	function k(_) {
		let O = r.length;
		while (O-- > _) {
			let I = r[O];
			t.containerState = I[1],
				b(I[0].exit, 'expected `exit` to be defined on container construct'),
				I[0].exit.call(t, e);
		}
		r.length = _;
	}
	function z() {
		b(t.containerState, 'expected `containerState` to be defined when closing flow'),
			b(i, 'expected `childFlow` to be defined when closing it'),
			i.write([p.eof]),
			o = void 0,
			i = void 0,
			t.containerState._closeFlow = void 0;
	}
}
function aA(e, t, r) {
	return b(this.parser.constructs.disable.null, 'expected `disable.null` to be populated'),
		j(
			e,
			e.attempt(this.parser.constructs.document, t, r),
			m.linePrefix,
			this.parser.constructs.disable.null.includes('codeIndented') ? void 0 : P.tabSize,
		);
}
function Se(e) {
	if (e === p.eof || G(e) || Qe(e)) return P.characterGroupWhitespace;
	if (Kt(e)) return P.characterGroupPunctuation;
}
function zt(e, t, r) {
	let n = [], i = -1;
	while (++i < e.length) {
		let o = e[i].resolveAll;
		if (o && !n.includes(o)) t = o(t, r), n.push(o);
	}
	return t;
}
var Sn = { name: 'attention', resolveAll: cA, tokenize: uA };
function cA(e, t) {
	let r = -1, n;
	while (++r < e.length) {
		if (e[r][0] === 'enter' && e[r][1].type === 'attentionSequence' && e[r][1]._close) {
			let i = r;
			while (i--) {
				if (
					e[i][0] === 'exit' && e[i][1].type === 'attentionSequence' && e[i][1]._open
					&& t.sliceSerialize(e[i][1]).charCodeAt(0) === t.sliceSerialize(e[r][1]).charCodeAt(0)
				) {
					if (
						(e[i][1]._close || e[r][1]._open) && (e[r][1].end.offset - e[r][1].start.offset) % 3
						&& !((e[i][1].end.offset - e[i][1].start.offset + e[r][1].end.offset - e[r][1].start.offset) % 3)
					) continue;
					let o = e[i][1].end.offset - e[i][1].start.offset > 1 && e[r][1].end.offset - e[r][1].start.offset > 1
							? 2
							: 1,
						s = { ...e[i][1].end },
						a = { ...e[r][1].start };
					Lg(s, -o), Lg(a, o);
					let c = { type: o > 1 ? m.strongSequence : m.emphasisSequence, start: s, end: { ...e[i][1].end } },
						u = { type: o > 1 ? m.strongSequence : m.emphasisSequence, start: { ...e[r][1].start }, end: a },
						l = { type: o > 1 ? m.strongText : m.emphasisText, start: { ...e[i][1].end }, end: { ...e[r][1].start } },
						f = { type: o > 1 ? m.strong : m.emphasis, start: { ...c.start }, end: { ...u.end } };
					if (
						e[i][1].end = { ...c.start },
							e[r][1].start = { ...u.end },
							n = [],
							e[i][1].end.offset - e[i][1].start.offset
					) n = we(n, [['enter', e[i][1], t], ['exit', e[i][1], t]]);
					n = we(n, [['enter', f, t], ['enter', c, t], ['exit', c, t], ['enter', l, t]]),
						b(t.parser.constructs.insideSpan.null, 'expected `insideSpan` to be populated'),
						n = we(n, zt(t.parser.constructs.insideSpan.null, e.slice(i + 1, r), t)),
						n = we(n, [['exit', l, t], ['enter', u, t], ['exit', u, t], ['exit', f, t]]);
					let h = 0;
					if (e[r][1].end.offset - e[r][1].start.offset) {
						h = 2, n = we(n, [['enter', e[r][1], t], ['exit', e[r][1], t]]);
					}
					he(e, i - 1, r - i + 3, n), r = i + n.length - h - 2;
					break;
				}
			}
		}
	}
	r = -1;
	while (++r < e.length) if (e[r][1].type === 'attentionSequence') e[r][1].type = 'data';
	return e;
}
function uA(e, t) {
	let r = this.parser.constructs.attentionMarkers.null, n = this.previous, i = Se(n), o;
	return s;
	function s(c) {
		return b(c === p.asterisk || c === p.underscore, 'expected asterisk or underscore'),
			o = c,
			e.enter('attentionSequence'),
			a(c);
	}
	function a(c) {
		if (c === o) return e.consume(c), a;
		let u = e.exit('attentionSequence'), l = Se(c);
		b(r, 'expected `attentionMarkers` to be populated');
		let f = !l || l === P.characterGroupPunctuation && i || r.includes(c) && c !== p.asterisk && c !== p.underscore,
			h = !i || i === P.characterGroupPunctuation && l || r.includes(n) && n !== p.asterisk && n !== p.underscore;
		return u._open = Boolean(o === p.asterisk ? f : f && (i || !h)),
			u._close = Boolean(o === p.asterisk ? h : h && (l || !f)),
			t(c);
	}
}
function Lg(e, t) {
	e.column += t, e.offset += t, e._bufferIndex += t;
}
var cc = { name: 'autolink', tokenize: lA };
function lA(e, t, r) {
	let n = 0;
	return i;
	function i(d) {
		return b(d === p.lessThan, 'expected `<`'),
			e.enter(m.autolink),
			e.enter(m.autolinkMarker),
			e.consume(d),
			e.exit(m.autolinkMarker),
			e.enter(m.autolinkProtocol),
			o;
	}
	function o(d) {
		if (oe(d)) return e.consume(d), s;
		if (d === p.atSign) return r(d);
		return u(d);
	}
	function s(d) {
		if (d === p.plusSign || d === p.dash || d === p.dot || ae(d)) return n = 1, a(d);
		return u(d);
	}
	function a(d) {
		if (d === p.colon) return e.consume(d), n = 0, c;
		if ((d === p.plusSign || d === p.dash || d === p.dot || ae(d)) && n++ < P.autolinkSchemeSizeMax) {
			return e.consume(d), a;
		}
		return n = 0, u(d);
	}
	function c(d) {
		if (d === p.greaterThan) {
			return e.exit(m.autolinkProtocol),
				e.enter(m.autolinkMarker),
				e.consume(d),
				e.exit(m.autolinkMarker),
				e.exit(m.autolink),
				t;
		}
		if (d === p.eof || d === p.space || d === p.lessThan || Vt(d)) return r(d);
		return e.consume(d), c;
	}
	function u(d) {
		if (d === p.atSign) return e.consume(d), l;
		if (Ag(d)) return e.consume(d), u;
		return r(d);
	}
	function l(d) {
		return ae(d) ? f(d) : r(d);
	}
	function f(d) {
		if (d === p.dot) return e.consume(d), n = 0, l;
		if (d === p.greaterThan) {
			return e.exit(m.autolinkProtocol).type = m.autolinkEmail,
				e.enter(m.autolinkMarker),
				e.consume(d),
				e.exit(m.autolinkMarker),
				e.exit(m.autolink),
				t;
		}
		return h(d);
	}
	function h(d) {
		if ((d === p.dash || ae(d)) && n++ < P.autolinkDomainSizeMax) {
			let g = d === p.dash ? h : f;
			return e.consume(d), g;
		}
		return r(d);
	}
}
var Xe = { partial: !0, tokenize: fA };
function fA(e, t, r) {
	return n;
	function n(o) {
		return R(o) ? j(e, i, m.linePrefix)(o) : i(o);
	}
	function i(o) {
		return o === p.eof || N(o) ? t(o) : r(o);
	}
}
var po = { continuation: { tokenize: hA }, exit: dA, name: 'blockQuote', tokenize: pA };
function pA(e, t, r) {
	let n = this;
	return i;
	function i(s) {
		if (s === p.greaterThan) {
			let a = n.containerState;
			if (b(a, 'expected `containerState` to be defined in container'), !a.open) {
				e.enter(m.blockQuote, { _container: !0 }), a.open = !0;
			}
			return e.enter(m.blockQuotePrefix), e.enter(m.blockQuoteMarker), e.consume(s), e.exit(m.blockQuoteMarker), o;
		}
		return r(s);
	}
	function o(s) {
		if (R(s)) {
			return e.enter(m.blockQuotePrefixWhitespace),
				e.consume(s),
				e.exit(m.blockQuotePrefixWhitespace),
				e.exit(m.blockQuotePrefix),
				t;
		}
		return e.exit(m.blockQuotePrefix), t(s);
	}
}
function hA(e, t, r) {
	let n = this;
	return i;
	function i(s) {
		if (R(s)) {
			return b(n.parser.constructs.disable.null, 'expected `disable.null` to be populated'),
				j(e, o, m.linePrefix, n.parser.constructs.disable.null.includes('codeIndented') ? void 0 : P.tabSize)(s);
		}
		return o(s);
	}
	function o(s) {
		return e.attempt(po, t, r)(s);
	}
}
function dA(e) {
	e.exit(m.blockQuote);
}
var ho = { name: 'characterEscape', tokenize: mA };
function mA(e, t, r) {
	return n;
	function n(o) {
		return b(o === p.backslash, 'expected `\\`'),
			e.enter(m.characterEscape),
			e.enter(m.escapeMarker),
			e.consume(o),
			e.exit(m.escapeMarker),
			i;
	}
	function i(o) {
		if (fo(o)) {
			return e.enter(m.characterEscapeValue),
				e.consume(o),
				e.exit(m.characterEscapeValue),
				e.exit(m.characterEscape),
				t;
		}
		return r(o);
	}
}
var mo = { name: 'characterReference', tokenize: gA };
function gA(e, t, r) {
	let n = this, i = 0, o, s;
	return a;
	function a(f) {
		return b(f === p.ampersand, 'expected `&`'),
			e.enter(m.characterReference),
			e.enter(m.characterReferenceMarker),
			e.consume(f),
			e.exit(m.characterReferenceMarker),
			c;
	}
	function c(f) {
		if (f === p.numberSign) {
			return e.enter(m.characterReferenceMarkerNumeric), e.consume(f), e.exit(m.characterReferenceMarkerNumeric), u;
		}
		return e.enter(m.characterReferenceValue), o = P.characterReferenceNamedSizeMax, s = ae, l(f);
	}
	function u(f) {
		if (f === p.uppercaseX || f === p.lowercaseX) {
			return e.enter(m.characterReferenceMarkerHexadecimal),
				e.consume(f),
				e.exit(m.characterReferenceMarkerHexadecimal),
				e.enter(m.characterReferenceValue),
				o = P.characterReferenceHexadecimalSizeMax,
				s = Eg,
				l;
		}
		return e.enter(m.characterReferenceValue), o = P.characterReferenceDecimalSizeMax, s = wn, l(f);
	}
	function l(f) {
		if (f === p.semicolon && i) {
			let h = e.exit(m.characterReferenceValue);
			if (s === ae && !vr(n.sliceSerialize(h))) return r(f);
			return e.enter(m.characterReferenceMarker),
				e.consume(f),
				e.exit(m.characterReferenceMarker),
				e.exit(m.characterReference),
				t;
		}
		if (s(f) && i++ < o) return e.consume(f), l;
		return r(f);
	}
}
var vn = { partial: !0, tokenize: yA };
function yA(e, t, r) {
	let n = this;
	return i;
	function i(s) {
		if (s === p.eof) return r(s);
		return b(N(s), 'expected eol'), e.enter(m.lineEnding), e.consume(s), e.exit(m.lineEnding), o;
	}
	function o(s) {
		return n.parser.lazy[n.now().line] ? r(s) : t(s);
	}
}
var go = { concrete: !0, name: 'codeFenced', tokenize: bA };
function bA(e, t, r) {
	let n = this, i = { partial: !0, tokenize: I }, o = 0, s = 0, a;
	return c;
	function c(v) {
		return u(v);
	}
	function u(v) {
		b(v === p.graveAccent || v === p.tilde, 'expected `` ` `` or `~`');
		let q = n.events[n.events.length - 1];
		return o = q && q[1].type === m.linePrefix ? q[2].sliceSerialize(q[1], !0).length : 0,
			a = v,
			e.enter(m.codeFenced),
			e.enter(m.codeFencedFence),
			e.enter(m.codeFencedFenceSequence),
			l(v);
	}
	function l(v) {
		if (v === a) return s++, e.consume(v), l;
		if (s < P.codeFencedSequenceSizeMin) return r(v);
		return e.exit(m.codeFencedFenceSequence), R(v) ? j(e, f, m.whitespace)(v) : f(v);
	}
	function f(v) {
		if (v === p.eof || N(v)) return e.exit(m.codeFencedFence), n.interrupt ? t(v) : e.check(vn, y, O)(v);
		return e.enter(m.codeFencedFenceInfo), e.enter(m.chunkString, { contentType: P.contentTypeString }), h(v);
	}
	function h(v) {
		if (v === p.eof || N(v)) return e.exit(m.chunkString), e.exit(m.codeFencedFenceInfo), f(v);
		if (R(v)) return e.exit(m.chunkString), e.exit(m.codeFencedFenceInfo), j(e, d, m.whitespace)(v);
		if (v === p.graveAccent && v === a) return r(v);
		return e.consume(v), h;
	}
	function d(v) {
		if (v === p.eof || N(v)) return f(v);
		return e.enter(m.codeFencedFenceMeta), e.enter(m.chunkString, { contentType: P.contentTypeString }), g(v);
	}
	function g(v) {
		if (v === p.eof || N(v)) return e.exit(m.chunkString), e.exit(m.codeFencedFenceMeta), f(v);
		if (v === p.graveAccent && v === a) return r(v);
		return e.consume(v), g;
	}
	function y(v) {
		return b(N(v), 'expected eol'), e.attempt(i, O, x)(v);
	}
	function x(v) {
		return b(N(v), 'expected eol'), e.enter(m.lineEnding), e.consume(v), e.exit(m.lineEnding), k;
	}
	function k(v) {
		return o > 0 && R(v) ? j(e, z, m.linePrefix, o + 1)(v) : z(v);
	}
	function z(v) {
		if (v === p.eof || N(v)) return e.check(vn, y, O)(v);
		return e.enter(m.codeFlowValue), _(v);
	}
	function _(v) {
		if (v === p.eof || N(v)) return e.exit(m.codeFlowValue), z(v);
		return e.consume(v), _;
	}
	function O(v) {
		return e.exit(m.codeFenced), t(v);
	}
	function I(v, q, L) {
		let U = 0;
		return C;
		function C(H) {
			return b(N(H), 'expected eol'), v.enter(m.lineEnding), v.consume(H), v.exit(m.lineEnding), J;
		}
		function J(H) {
			return b(n.parser.constructs.disable.null, 'expected `disable.null` to be populated'),
				v.enter(m.codeFencedFence),
				R(H)
					? j(v, Z, m.linePrefix, n.parser.constructs.disable.null.includes('codeIndented') ? void 0 : P.tabSize)(H)
					: Z(H);
		}
		function Z(H) {
			if (H === a) return v.enter(m.codeFencedFenceSequence), M(H);
			return L(H);
		}
		function M(H) {
			if (H === a) return U++, v.consume(H), M;
			if (U >= s) return v.exit(m.codeFencedFenceSequence), R(H) ? j(v, V, m.whitespace)(H) : V(H);
			return L(H);
		}
		function V(H) {
			if (H === p.eof || N(H)) return v.exit(m.codeFencedFence), q(H);
			return L(H);
		}
	}
}
var _n = { name: 'codeIndented', tokenize: kA }, xA = { partial: !0, tokenize: wA };
function kA(e, t, r) {
	return n;
	function n(a) {
		return b(R(a)), e.enter(m.codeIndented), ac(e, i, r, m.linePrefix, P.tabSize, P.tabSize)(a);
	}
	function i(a) {
		if (a === p.eof) return s(a);
		if (N(a)) return e.attempt(xA, i, s)(a);
		return e.enter(m.codeFlowValue), o(a);
	}
	function o(a) {
		if (a === p.eof || N(a)) return e.exit(m.codeFlowValue), i(a);
		return e.consume(a), o;
	}
	function s(a) {
		return e.exit(m.codeIndented), t(a);
	}
}
function wA(e, t, r) {
	let n = this;
	return i;
	function i(s) {
		if (n.parser.lazy[n.now().line]) return r(s);
		if (N(s)) return e.enter(m.lineEnding), e.consume(s), e.exit(m.lineEnding), i;
		return ac(e, t, o, m.linePrefix, P.tabSize, P.tabSize)(s);
	}
	function o(s) {
		return N(s) ? i(s) : r(s);
	}
}
var uc = { name: 'codeText', previous: Ng, resolve: SA, tokenize: vA };
function SA(e) {
	let t = e.length - 4, r = 3, n, i;
	if (
		(e[r][1].type === m.lineEnding || e[r][1].type === 'space')
		&& (e[t][1].type === m.lineEnding || e[t][1].type === 'space')
	) {
		n = r;
		while (++n < t) {
			if (e[n][1].type === m.codeTextData) {
				e[r][1].type = m.codeTextPadding, e[t][1].type = m.codeTextPadding, r += 2, t -= 2;
				break;
			}
		}
	}
	n = r - 1, t++;
	while (++n <= t) {
		if (i === void 0) { if (n !== t && e[n][1].type !== m.lineEnding) i = n; }
		else if (n === t || e[n][1].type === m.lineEnding) {
			if (e[i][1].type = m.codeTextData, n !== i + 2) {
				e[i][1].end = e[n - 1][1].end, e.splice(i + 2, n - i - 2), t -= n - i - 2, n = i + 2;
			}
			i = void 0;
		}
	}
	return e;
}
function Ng(e) {
	return e !== p.graveAccent || this.events[this.events.length - 1][1].type === m.characterEscape;
}
function vA(e, t, r) {
	let n = this, i = 0, o, s;
	return a;
	function a(h) {
		return b(h === p.graveAccent, 'expected `` ` ``'),
			b(Ng.call(n, n.previous), 'expected correct previous'),
			e.enter(m.codeText),
			e.enter(m.codeTextSequence),
			c(h);
	}
	function c(h) {
		if (h === p.graveAccent) return e.consume(h), i++, c;
		return e.exit(m.codeTextSequence), u(h);
	}
	function u(h) {
		if (h === p.eof) return r(h);
		if (h === p.space) return e.enter('space'), e.consume(h), e.exit('space'), u;
		if (h === p.graveAccent) return s = e.enter(m.codeTextSequence), o = 0, f(h);
		if (N(h)) return e.enter(m.lineEnding), e.consume(h), e.exit(m.lineEnding), u;
		return e.enter(m.codeTextData), l(h);
	}
	function l(h) {
		if (h === p.eof || h === p.space || h === p.graveAccent || N(h)) return e.exit(m.codeTextData), u(h);
		return e.consume(h), l;
	}
	function f(h) {
		if (h === p.graveAccent) return e.consume(h), o++, f;
		if (o === i) return e.exit(m.codeTextSequence), e.exit(m.codeText), t(h);
		return s.type = m.codeTextData, l(h);
	}
}
class lc {
	constructor(e) {
		this.left = e ? [...e] : [], this.right = [];
	}
	get(e) {
		if (e < 0 || e >= this.left.length + this.right.length) {
			throw RangeError(
				'Cannot access index `' + e + '` in a splice buffer of size `' + (this.left.length + this.right.length) + '`',
			);
		}
		if (e < this.left.length) return this.left[e];
		return this.right[this.right.length - e + this.left.length - 1];
	}
	get length() {
		return this.left.length + this.right.length;
	}
	shift() {
		return this.setCursor(0), this.right.pop();
	}
	slice(e, t) {
		let r = t === null || t === void 0 ? Number.POSITIVE_INFINITY : t;
		if (r < this.left.length) return this.left.slice(e, r);
		if (e > this.left.length) {
			return this.right.slice(this.right.length - r + this.left.length, this.right.length - e + this.left.length)
				.reverse();
		}
		return this.left.slice(e).concat(this.right.slice(this.right.length - r + this.left.length).reverse());
	}
	splice(e, t, r) {
		let n = t || 0;
		this.setCursor(Math.trunc(e));
		let i = this.right.splice(this.right.length - n, Number.POSITIVE_INFINITY);
		if (r) Cn(this.left, r);
		return i.reverse();
	}
	pop() {
		return this.setCursor(Number.POSITIVE_INFINITY), this.left.pop();
	}
	push(e) {
		this.setCursor(Number.POSITIVE_INFINITY), this.left.push(e);
	}
	pushMany(e) {
		this.setCursor(Number.POSITIVE_INFINITY), Cn(this.left, e);
	}
	unshift(e) {
		this.setCursor(0), this.right.push(e);
	}
	unshiftMany(e) {
		this.setCursor(0), Cn(this.right, e.reverse());
	}
	setCursor(e) {
		if (e === this.left.length || e > this.left.length && this.right.length === 0 || e < 0 && this.left.length === 0) {
			return;
		}
		if (e < this.left.length) {
			let t = this.left.splice(e, Number.POSITIVE_INFINITY);
			Cn(this.right, t.reverse());
		} else {
			let t = this.right.splice(this.left.length + this.right.length - e, Number.POSITIVE_INFINITY);
			Cn(this.left, t.reverse());
		}
	}
}
function Cn(e, t) {
	let r = 0;
	if (t.length < P.v8MaxSafeChunkSize) e.push(...t);
	else while (r < t.length) e.push(...t.slice(r, r + P.v8MaxSafeChunkSize)), r += P.v8MaxSafeChunkSize;
}
function yo(e) {
	let t = {}, r = -1, n, i, o, s, a, c, u, l = new lc(e);
	while (++r < l.length) {
		while (r in t) r = t[r];
		if (n = l.get(r), r && n[1].type === m.chunkFlow && l.get(r - 1)[1].type === m.listItemPrefix) {
			if (
				b(n[1]._tokenizer, 'expected `_tokenizer` on subtokens'),
					c = n[1]._tokenizer.events,
					o = 0,
					o < c.length && c[o][1].type === m.lineEndingBlank
			) o += 2;
			if (o < c.length && c[o][1].type === m.content) {
				while (++o < c.length) {
					if (c[o][1].type === m.content) break;
					if (c[o][1].type === m.chunkText) c[o][1]._isInFirstContentOfListItem = !0, o++;
				}
			}
		}
		if (n[0] === 'enter') { if (n[1].contentType) Object.assign(t, _A(l, r)), r = t[r], u = !0; }
		else if (n[1]._container) {
			o = r, i = void 0;
			while (o--) {
				if (s = l.get(o), s[1].type === m.lineEnding || s[1].type === m.lineEndingBlank) {
					if (s[0] === 'enter') {
						if (i) l.get(i)[1].type = m.lineEndingBlank;
						s[1].type = m.lineEnding, i = o;
					}
				} else if (s[1].type === m.linePrefix || s[1].type === m.listItemIndent);
				else break;
			}
			if (i) n[1].end = { ...l.get(i)[1].start }, a = l.slice(i, r), a.unshift(n), l.splice(i, r - i + 1, a);
		}
	}
	return he(e, 0, Number.POSITIVE_INFINITY, l.slice(0)), !u;
}
function _A(e, t) {
	let r = e.get(t)[1], n = e.get(t)[2], i = t - 1, o = [];
	b(r.contentType, 'expected `contentType` on subtokens');
	let s = r._tokenizer;
	if (!s) { if (s = n.parser[r.contentType](r.start), r._contentTypeTextTrailing) s._contentTypeTextTrailing = !0; }
	let a = s.events, c = [], u = {}, l, f, h = -1, d = r, g = 0, y = 0, x = [y];
	while (d) {
		while (e.get(++i)[1] !== d);
		if (
			b(!f || d.previous === f, 'expected previous to match'),
				b(!f || f.next === d, 'expected next to match'),
				o.push(i),
				!d._tokenizer
		) {
			if (l = n.sliceStream(d), !d.next) l.push(p.eof);
			if (f) s.defineSkip(d.start);
			if (d._isInFirstContentOfListItem) s._gfmTasklistFirstContentOfListItem = !0;
			if (s.write(l), d._isInFirstContentOfListItem) s._gfmTasklistFirstContentOfListItem = void 0;
		}
		f = d, d = d.next;
	}
	d = r;
	while (++h < a.length) {
		if (
			a[h][0] === 'exit' && a[h - 1][0] === 'enter' && a[h][1].type === a[h - 1][1].type
			&& a[h][1].start.line !== a[h][1].end.line
		) b(d, 'expected a current token'), y = h + 1, x.push(y), d._tokenizer = void 0, d.previous = void 0, d = d.next;
	}
	if (s.events = [], d) d._tokenizer = void 0, d.previous = void 0, b(!d.next, 'expected no next token');
	else x.pop();
	h = x.length;
	while (h--) {
		let k = a.slice(x[h], x[h + 1]), z = o.pop();
		b(z !== void 0, 'expected a start position when splicing'), c.push([z, z + k.length - 1]), e.splice(z, 2, k);
	}
	c.reverse(), h = -1;
	while (++h < c.length) u[g + c[h][0]] = g + c[h][1], g += c[h][1] - c[h][0] - 1;
	return u;
}
var fc = { resolve: zA, tokenize: TA }, CA = { partial: !0, tokenize: AA };
function zA(e) {
	return yo(e), e;
}
function TA(e, t) {
	let r;
	return n;
	function n(a) {
		return b(a !== p.eof && !N(a), 'expected no eof or eol'),
			e.enter(m.content),
			r = e.enter(m.chunkContent, { contentType: P.contentTypeContent }),
			i(a);
	}
	function i(a) {
		if (a === p.eof) return o(a);
		if (N(a)) return e.check(CA, s, o)(a);
		return e.consume(a), i;
	}
	function o(a) {
		return e.exit(m.chunkContent), e.exit(m.content), t(a);
	}
	function s(a) {
		return b(N(a), 'expected eol'),
			e.consume(a),
			e.exit(m.chunkContent),
			b(r, 'expected previous token'),
			r.next = e.enter(m.chunkContent, { contentType: P.contentTypeContent, previous: r }),
			r = r.next,
			i;
	}
}
function AA(e, t, r) {
	let n = this;
	return i;
	function i(s) {
		return b(N(s), 'expected a line ending'),
			e.exit(m.chunkContent),
			e.enter(m.lineEnding),
			e.consume(s),
			e.exit(m.lineEnding),
			j(e, o, m.linePrefix);
	}
	function o(s) {
		if (s === p.eof || N(s)) return r(s);
		b(n.parser.constructs.disable.null, 'expected `disable.null` to be populated');
		let a = n.events[n.events.length - 1];
		if (
			!n.parser.constructs.disable.null.includes('codeIndented') && a && a[1].type === m.linePrefix
			&& a[2].sliceSerialize(a[1], !0).length >= P.tabSize
		) return t(s);
		return e.interrupt(n.parser.constructs.flow, r, t)(s);
	}
}
function bo(e, t, r, n, i, o, s, a, c) {
	let u = c || Number.POSITIVE_INFINITY, l = 0;
	return f;
	function f(k) {
		if (k === p.lessThan) return e.enter(n), e.enter(i), e.enter(o), e.consume(k), e.exit(o), h;
		if (k === p.eof || k === p.space || k === p.rightParenthesis || Vt(k)) return r(k);
		return e.enter(n), e.enter(s), e.enter(a), e.enter(m.chunkString, { contentType: P.contentTypeString }), y(k);
	}
	function h(k) {
		if (k === p.greaterThan) return e.enter(o), e.consume(k), e.exit(o), e.exit(i), e.exit(n), t;
		return e.enter(a), e.enter(m.chunkString, { contentType: P.contentTypeString }), d(k);
	}
	function d(k) {
		if (k === p.greaterThan) return e.exit(m.chunkString), e.exit(a), h(k);
		if (k === p.eof || k === p.lessThan || N(k)) return r(k);
		return e.consume(k), k === p.backslash ? g : d;
	}
	function g(k) {
		if (k === p.lessThan || k === p.greaterThan || k === p.backslash) return e.consume(k), d;
		return d(k);
	}
	function y(k) {
		if (!l && (k === p.eof || k === p.rightParenthesis || G(k))) {
			return e.exit(m.chunkString), e.exit(a), e.exit(s), e.exit(n), t(k);
		}
		if (l < u && k === p.leftParenthesis) return e.consume(k), l++, y;
		if (k === p.rightParenthesis) return e.consume(k), l--, y;
		if (k === p.eof || k === p.space || k === p.leftParenthesis || Vt(k)) return r(k);
		return e.consume(k), k === p.backslash ? x : y;
	}
	function x(k) {
		if (k === p.leftParenthesis || k === p.rightParenthesis || k === p.backslash) return e.consume(k), y;
		return y(k);
	}
}
function xo(e, t, r, n, i, o) {
	let s = this, a = 0, c;
	return u;
	function u(d) {
		return b(d === p.leftSquareBracket, 'expected `[`'), e.enter(n), e.enter(i), e.consume(d), e.exit(i), e.enter(o), l;
	}
	function l(d) {
		if (
			a > P.linkReferenceSizeMax || d === p.eof || d === p.leftSquareBracket || d === p.rightSquareBracket && !c
			|| d === p.caret && !a && '_hiddenFootnoteSupport' in s.parser.constructs
		) return r(d);
		if (d === p.rightSquareBracket) return e.exit(o), e.enter(i), e.consume(d), e.exit(i), e.exit(n), t;
		if (N(d)) return e.enter(m.lineEnding), e.consume(d), e.exit(m.lineEnding), l;
		return e.enter(m.chunkString, { contentType: P.contentTypeString }), f(d);
	}
	function f(d) {
		if (
			d === p.eof || d === p.leftSquareBracket || d === p.rightSquareBracket || N(d) || a++ > P.linkReferenceSizeMax
		) return e.exit(m.chunkString), l(d);
		if (e.consume(d), !c) c = !R(d);
		return d === p.backslash ? h : f;
	}
	function h(d) {
		if (d === p.leftSquareBracket || d === p.backslash || d === p.rightSquareBracket) return e.consume(d), a++, f;
		return f(d);
	}
}
function ko(e, t, r, n, i, o) {
	let s;
	return a;
	function a(h) {
		if (h === p.quotationMark || h === p.apostrophe || h === p.leftParenthesis) {
			return e.enter(n), e.enter(i), e.consume(h), e.exit(i), s = h === p.leftParenthesis ? p.rightParenthesis : h, c;
		}
		return r(h);
	}
	function c(h) {
		if (h === s) return e.enter(i), e.consume(h), e.exit(i), e.exit(n), t;
		return e.enter(o), u(h);
	}
	function u(h) {
		if (h === s) return e.exit(o), c(s);
		if (h === p.eof) return r(h);
		if (N(h)) return e.enter(m.lineEnding), e.consume(h), e.exit(m.lineEnding), j(e, u, m.linePrefix);
		return e.enter(m.chunkString, { contentType: P.contentTypeString }), l(h);
	}
	function l(h) {
		if (h === s || h === p.eof || N(h)) return e.exit(m.chunkString), u(h);
		return e.consume(h), h === p.backslash ? f : l;
	}
	function f(h) {
		if (h === s || h === p.backslash) return e.consume(h), l;
		return l(h);
	}
}
function Jt(e, t) {
	let r;
	return n;
	function n(i) {
		if (N(i)) return e.enter(m.lineEnding), e.consume(i), e.exit(m.lineEnding), r = !0, n;
		if (R(i)) return j(e, n, r ? m.linePrefix : m.lineSuffix)(i);
		return t(i);
	}
}
var pc = { name: 'definition', tokenize: IA }, EA = { partial: !0, tokenize: PA };
function IA(e, t, r) {
	let n = this, i;
	return o;
	function o(d) {
		return e.enter(m.definition), s(d);
	}
	function s(d) {
		return b(d === p.leftSquareBracket, 'expected `[`'),
			xo.call(n, e, a, r, m.definitionLabel, m.definitionLabelMarker, m.definitionLabelString)(d);
	}
	function a(d) {
		if (i = ye(n.sliceSerialize(n.events[n.events.length - 1][1]).slice(1, -1)), d === p.colon) {
			return e.enter(m.definitionMarker), e.consume(d), e.exit(m.definitionMarker), c;
		}
		return r(d);
	}
	function c(d) {
		return G(d) ? Jt(e, u)(d) : u(d);
	}
	function u(d) {
		return bo(
			e,
			l,
			r,
			m.definitionDestination,
			m.definitionDestinationLiteral,
			m.definitionDestinationLiteralMarker,
			m.definitionDestinationRaw,
			m.definitionDestinationString,
		)(d);
	}
	function l(d) {
		return e.attempt(EA, f, f)(d);
	}
	function f(d) {
		return R(d) ? j(e, h, m.whitespace)(d) : h(d);
	}
	function h(d) {
		if (d === p.eof || N(d)) return e.exit(m.definition), n.parser.defined.push(i), t(d);
		return r(d);
	}
}
function PA(e, t, r) {
	return n;
	function n(a) {
		return G(a) ? Jt(e, i)(a) : r(a);
	}
	function i(a) {
		return ko(e, o, r, m.definitionTitle, m.definitionTitleMarker, m.definitionTitleString)(a);
	}
	function o(a) {
		return R(a) ? j(e, s, m.whitespace)(a) : s(a);
	}
	function s(a) {
		return a === p.eof || N(a) ? t(a) : r(a);
	}
}
var hc = { name: 'hardBreakEscape', tokenize: OA };
function OA(e, t, r) {
	return n;
	function n(o) {
		return b(o === p.backslash, 'expected `\\`'), e.enter(m.hardBreakEscape), e.consume(o), i;
	}
	function i(o) {
		if (N(o)) return e.exit(m.hardBreakEscape), t(o);
		return r(o);
	}
}
var dc = { name: 'headingAtx', resolve: $A, tokenize: LA };
function $A(e, t) {
	let r = e.length - 2, n = 3;
	if (e[n][1].type === m.whitespace) n += 2;
	if (r - 2 > n && e[r][1].type === m.whitespace) r -= 2;
	if (e[r][1].type === m.atxHeadingSequence && (n === r - 1 || r - 4 > n && e[r - 2][1].type === m.whitespace)) {
		r -= n + 1 === r ? 2 : 4;
	}
	if (r > n) {
		let i = { type: m.atxHeadingText, start: e[n][1].start, end: e[r][1].end },
			o = { type: m.chunkText, start: e[n][1].start, end: e[r][1].end, contentType: P.contentTypeText };
		he(e, n, r - n + 1, [['enter', i, t], ['enter', o, t], ['exit', o, t], ['exit', i, t]]);
	}
	return e;
}
function LA(e, t, r) {
	let n = 0;
	return i;
	function i(l) {
		return e.enter(m.atxHeading), o(l);
	}
	function o(l) {
		return b(l === p.numberSign, 'expected `#`'), e.enter(m.atxHeadingSequence), s(l);
	}
	function s(l) {
		if (l === p.numberSign && n++ < P.atxHeadingOpeningFenceSizeMax) return e.consume(l), s;
		if (l === p.eof || G(l)) return e.exit(m.atxHeadingSequence), a(l);
		return r(l);
	}
	function a(l) {
		if (l === p.numberSign) return e.enter(m.atxHeadingSequence), c(l);
		if (l === p.eof || N(l)) return e.exit(m.atxHeading), t(l);
		if (R(l)) return j(e, a, m.whitespace)(l);
		return e.enter(m.atxHeadingText), u(l);
	}
	function c(l) {
		if (l === p.numberSign) return e.consume(l), c;
		return e.exit(m.atxHeadingSequence), a(l);
	}
	function u(l) {
		if (l === p.eof || l === p.numberSign || G(l)) return e.exit(m.atxHeadingText), a(l);
		return e.consume(l), u;
	}
}
var wo = [
		'address',
		'article',
		'aside',
		'base',
		'basefont',
		'blockquote',
		'body',
		'caption',
		'center',
		'col',
		'colgroup',
		'dd',
		'details',
		'dialog',
		'dir',
		'div',
		'dl',
		'dt',
		'fieldset',
		'figcaption',
		'figure',
		'footer',
		'form',
		'frame',
		'frameset',
		'h1',
		'h2',
		'h3',
		'h4',
		'h5',
		'h6',
		'head',
		'header',
		'hr',
		'html',
		'iframe',
		'legend',
		'li',
		'link',
		'main',
		'menu',
		'menuitem',
		'nav',
		'noframes',
		'ol',
		'optgroup',
		'option',
		'p',
		'param',
		'search',
		'section',
		'summary',
		'table',
		'tbody',
		'td',
		'tfoot',
		'th',
		'thead',
		'title',
		'tr',
		'track',
		'ul',
	],
	zn = ['pre', 'script', 'style', 'textarea'];
var mc = { concrete: !0, name: 'htmlFlow', resolveTo: qA, tokenize: DA }, NA = { partial: !0, tokenize: MA };
function qA(e) {
	let t = e.length;
	while (t--) if (e[t][0] === 'enter' && e[t][1].type === m.htmlFlow) break;
	if (t > 1 && e[t - 2][1].type === m.linePrefix) {
		e[t][1].start = e[t - 2][1].start, e[t + 1][1].start = e[t - 2][1].start, e.splice(t - 2, 2);
	}
	return e;
}
function DA(e, t, r) {
	let n = this, i, o, s, a, c;
	return u;
	function u(S) {
		return l(S);
	}
	function l(S) {
		return b(S === p.lessThan, 'expected `<`'), e.enter(m.htmlFlow), e.enter(m.htmlFlowData), e.consume(S), f;
	}
	function f(S) {
		if (S === p.exclamationMark) return e.consume(S), h;
		if (S === p.slash) return e.consume(S), o = !0, y;
		if (S === p.questionMark) return e.consume(S), i = P.htmlInstruction, n.interrupt ? t : w;
		if (oe(S)) return b(S !== null), e.consume(S), s = String.fromCharCode(S), x;
		return r(S);
	}
	function h(S) {
		if (S === p.dash) return e.consume(S), i = P.htmlComment, d;
		if (S === p.leftSquareBracket) return e.consume(S), i = P.htmlCdata, a = 0, g;
		if (oe(S)) return e.consume(S), i = P.htmlDeclaration, n.interrupt ? t : w;
		return r(S);
	}
	function d(S) {
		if (S === p.dash) return e.consume(S), n.interrupt ? t : w;
		return r(S);
	}
	function g(S) {
		let _e = P.cdataOpeningString;
		if (S === _e.charCodeAt(a++)) {
			if (e.consume(S), a === _e.length) return n.interrupt ? t : Z;
			return g;
		}
		return r(S);
	}
	function y(S) {
		if (oe(S)) return b(S !== null), e.consume(S), s = String.fromCharCode(S), x;
		return r(S);
	}
	function x(S) {
		if (S === p.eof || S === p.slash || S === p.greaterThan || G(S)) {
			let _e = S === p.slash, nr = s.toLowerCase();
			if (!_e && !o && zn.includes(nr)) return i = P.htmlRaw, n.interrupt ? t(S) : Z(S);
			if (wo.includes(s.toLowerCase())) {
				if (i = P.htmlBasic, _e) return e.consume(S), k;
				return n.interrupt ? t(S) : Z(S);
			}
			return i = P.htmlComplete, n.interrupt && !n.parser.lazy[n.now().line] ? r(S) : o ? z(S) : _(S);
		}
		if (S === p.dash || ae(S)) return e.consume(S), s += String.fromCharCode(S), x;
		return r(S);
	}
	function k(S) {
		if (S === p.greaterThan) return e.consume(S), n.interrupt ? t : Z;
		return r(S);
	}
	function z(S) {
		if (R(S)) return e.consume(S), z;
		return C(S);
	}
	function _(S) {
		if (S === p.slash) return e.consume(S), C;
		if (S === p.colon || S === p.underscore || oe(S)) return e.consume(S), O;
		if (R(S)) return e.consume(S), _;
		return C(S);
	}
	function O(S) {
		if (S === p.dash || S === p.dot || S === p.colon || S === p.underscore || ae(S)) return e.consume(S), O;
		return I(S);
	}
	function I(S) {
		if (S === p.equalsTo) return e.consume(S), v;
		if (R(S)) return e.consume(S), I;
		return _(S);
	}
	function v(S) {
		if (S === p.eof || S === p.lessThan || S === p.equalsTo || S === p.greaterThan || S === p.graveAccent) return r(S);
		if (S === p.quotationMark || S === p.apostrophe) return e.consume(S), c = S, q;
		if (R(S)) return e.consume(S), v;
		return L(S);
	}
	function q(S) {
		if (S === c) return e.consume(S), c = null, U;
		if (S === p.eof || N(S)) return r(S);
		return e.consume(S), q;
	}
	function L(S) {
		if (
			S === p.eof || S === p.quotationMark || S === p.apostrophe || S === p.slash || S === p.lessThan
			|| S === p.equalsTo || S === p.greaterThan || S === p.graveAccent || G(S)
		) return I(S);
		return e.consume(S), L;
	}
	function U(S) {
		if (S === p.slash || S === p.greaterThan || R(S)) return _(S);
		return r(S);
	}
	function C(S) {
		if (S === p.greaterThan) return e.consume(S), J;
		return r(S);
	}
	function J(S) {
		if (S === p.eof || N(S)) return Z(S);
		if (R(S)) return e.consume(S), J;
		return r(S);
	}
	function Z(S) {
		if (S === p.dash && i === P.htmlComment) return e.consume(S), ne;
		if (S === p.lessThan && i === P.htmlRaw) return e.consume(S), ue;
		if (S === p.greaterThan && i === P.htmlDeclaration) return e.consume(S), Pe;
		if (S === p.questionMark && i === P.htmlInstruction) return e.consume(S), w;
		if (S === p.rightSquareBracket && i === P.htmlCdata) return e.consume(S), Ue;
		if (N(S) && (i === P.htmlBasic || i === P.htmlComplete)) return e.exit(m.htmlFlowData), e.check(NA, tt, M)(S);
		if (S === p.eof || N(S)) return e.exit(m.htmlFlowData), M(S);
		return e.consume(S), Z;
	}
	function M(S) {
		return e.check(vn, V, tt)(S);
	}
	function V(S) {
		return b(N(S)), e.enter(m.lineEnding), e.consume(S), e.exit(m.lineEnding), H;
	}
	function H(S) {
		if (S === p.eof || N(S)) return M(S);
		return e.enter(m.htmlFlowData), Z(S);
	}
	function ne(S) {
		if (S === p.dash) return e.consume(S), w;
		return Z(S);
	}
	function ue(S) {
		if (S === p.slash) return e.consume(S), s = '', Ie;
		return Z(S);
	}
	function Ie(S) {
		if (S === p.greaterThan) {
			let _e = s.toLowerCase();
			if (zn.includes(_e)) return e.consume(S), Pe;
			return Z(S);
		}
		if (oe(S) && s.length < P.htmlRawSizeMax) return b(S !== null), e.consume(S), s += String.fromCharCode(S), Ie;
		return Z(S);
	}
	function Ue(S) {
		if (S === p.rightSquareBracket) return e.consume(S), w;
		return Z(S);
	}
	function w(S) {
		if (S === p.greaterThan) return e.consume(S), Pe;
		if (S === p.dash && i === P.htmlComment) return e.consume(S), w;
		return Z(S);
	}
	function Pe(S) {
		if (S === p.eof || N(S)) return e.exit(m.htmlFlowData), tt(S);
		return e.consume(S), Pe;
	}
	function tt(S) {
		return e.exit(m.htmlFlow), t(S);
	}
}
function MA(e, t, r) {
	return n;
	function n(i) {
		return b(N(i), 'expected a line ending'),
			e.enter(m.lineEnding),
			e.consume(i),
			e.exit(m.lineEnding),
			e.attempt(Xe, t, r);
	}
}
var gc = { name: 'htmlText', tokenize: FA };
function FA(e, t, r) {
	let n = this, i, o, s;
	return a;
	function a(w) {
		return b(w === p.lessThan, 'expected `<`'), e.enter(m.htmlText), e.enter(m.htmlTextData), e.consume(w), c;
	}
	function c(w) {
		if (w === p.exclamationMark) return e.consume(w), u;
		if (w === p.slash) return e.consume(w), I;
		if (w === p.questionMark) return e.consume(w), _;
		if (oe(w)) return e.consume(w), L;
		return r(w);
	}
	function u(w) {
		if (w === p.dash) return e.consume(w), l;
		if (w === p.leftSquareBracket) return e.consume(w), o = 0, g;
		if (oe(w)) return e.consume(w), z;
		return r(w);
	}
	function l(w) {
		if (w === p.dash) return e.consume(w), d;
		return r(w);
	}
	function f(w) {
		if (w === p.eof) return r(w);
		if (w === p.dash) return e.consume(w), h;
		if (N(w)) return s = f, ue(w);
		return e.consume(w), f;
	}
	function h(w) {
		if (w === p.dash) return e.consume(w), d;
		return f(w);
	}
	function d(w) {
		return w === p.greaterThan ? ne(w) : w === p.dash ? h(w) : f(w);
	}
	function g(w) {
		let Pe = P.cdataOpeningString;
		if (w === Pe.charCodeAt(o++)) return e.consume(w), o === Pe.length ? y : g;
		return r(w);
	}
	function y(w) {
		if (w === p.eof) return r(w);
		if (w === p.rightSquareBracket) return e.consume(w), x;
		if (N(w)) return s = y, ue(w);
		return e.consume(w), y;
	}
	function x(w) {
		if (w === p.rightSquareBracket) return e.consume(w), k;
		return y(w);
	}
	function k(w) {
		if (w === p.greaterThan) return ne(w);
		if (w === p.rightSquareBracket) return e.consume(w), k;
		return y(w);
	}
	function z(w) {
		if (w === p.eof || w === p.greaterThan) return ne(w);
		if (N(w)) return s = z, ue(w);
		return e.consume(w), z;
	}
	function _(w) {
		if (w === p.eof) return r(w);
		if (w === p.questionMark) return e.consume(w), O;
		if (N(w)) return s = _, ue(w);
		return e.consume(w), _;
	}
	function O(w) {
		return w === p.greaterThan ? ne(w) : _(w);
	}
	function I(w) {
		if (oe(w)) return e.consume(w), v;
		return r(w);
	}
	function v(w) {
		if (w === p.dash || ae(w)) return e.consume(w), v;
		return q(w);
	}
	function q(w) {
		if (N(w)) return s = q, ue(w);
		if (R(w)) return e.consume(w), q;
		return ne(w);
	}
	function L(w) {
		if (w === p.dash || ae(w)) return e.consume(w), L;
		if (w === p.slash || w === p.greaterThan || G(w)) return U(w);
		return r(w);
	}
	function U(w) {
		if (w === p.slash) return e.consume(w), ne;
		if (w === p.colon || w === p.underscore || oe(w)) return e.consume(w), C;
		if (N(w)) return s = U, ue(w);
		if (R(w)) return e.consume(w), U;
		return ne(w);
	}
	function C(w) {
		if (w === p.dash || w === p.dot || w === p.colon || w === p.underscore || ae(w)) return e.consume(w), C;
		return J(w);
	}
	function J(w) {
		if (w === p.equalsTo) return e.consume(w), Z;
		if (N(w)) return s = J, ue(w);
		if (R(w)) return e.consume(w), J;
		return U(w);
	}
	function Z(w) {
		if (w === p.eof || w === p.lessThan || w === p.equalsTo || w === p.greaterThan || w === p.graveAccent) return r(w);
		if (w === p.quotationMark || w === p.apostrophe) return e.consume(w), i = w, M;
		if (N(w)) return s = Z, ue(w);
		if (R(w)) return e.consume(w), Z;
		return e.consume(w), V;
	}
	function M(w) {
		if (w === i) return e.consume(w), i = void 0, H;
		if (w === p.eof) return r(w);
		if (N(w)) return s = M, ue(w);
		return e.consume(w), M;
	}
	function V(w) {
		if (
			w === p.eof || w === p.quotationMark || w === p.apostrophe || w === p.lessThan || w === p.equalsTo
			|| w === p.graveAccent
		) return r(w);
		if (w === p.slash || w === p.greaterThan || G(w)) return U(w);
		return e.consume(w), V;
	}
	function H(w) {
		if (w === p.slash || w === p.greaterThan || G(w)) return U(w);
		return r(w);
	}
	function ne(w) {
		if (w === p.greaterThan) return e.consume(w), e.exit(m.htmlTextData), e.exit(m.htmlText), t;
		return r(w);
	}
	function ue(w) {
		return b(s, 'expected return state'),
			b(N(w), 'expected eol'),
			e.exit(m.htmlTextData),
			e.enter(m.lineEnding),
			e.consume(w),
			e.exit(m.lineEnding),
			Ie;
	}
	function Ie(w) {
		return b(n.parser.constructs.disable.null, 'expected `disable.null` to be populated'),
			R(w)
				? j(e, Ue, m.linePrefix, n.parser.constructs.disable.null.includes('codeIndented') ? void 0 : P.tabSize)(w)
				: Ue(w);
	}
	function Ue(w) {
		return e.enter(m.htmlTextData), s(w);
	}
}
var Ht = { name: 'labelEnd', resolveAll: jA, resolveTo: UA, tokenize: VA },
	RA = { tokenize: KA },
	BA = { tokenize: JA },
	ZA = { tokenize: HA };
function jA(e) {
	let t = -1, r = [];
	while (++t < e.length) {
		let n = e[t][1];
		if (r.push(e[t]), n.type === m.labelImage || n.type === m.labelLink || n.type === m.labelEnd) {
			let i = n.type === m.labelImage ? 4 : 2;
			n.type = m.data, t += i;
		}
	}
	if (e.length !== r.length) he(e, 0, e.length, r);
	return e;
}
function UA(e, t) {
	let r = e.length, n = 0, i, o, s;
	while (r--) {
		let l = e[r][1];
		if (i) {
			if (l.type === m.link || l.type === m.labelLink && l._inactive) break;
			if (e[r][0] === 'enter' && l.type === m.labelLink) l._inactive = !0;
		} else if (o) {
			if (e[r][0] === 'enter' && (l.type === m.labelImage || l.type === m.labelLink) && !l._balanced) {
				if (i = r, l.type !== m.labelLink) {
					n = 2;
					break;
				}
			}
		} else if (l.type === m.labelEnd) o = r;
	}
	b(i !== void 0, '`open` is supposed to be found'), b(o !== void 0, '`close` is supposed to be found');
	let a = {
			type: e[i][1].type === m.labelLink ? m.link : m.image,
			start: { ...e[i][1].start },
			end: { ...e[e.length - 1][1].end },
		},
		c = { type: m.label, start: { ...e[i][1].start }, end: { ...e[o][1].end } },
		u = { type: m.labelText, start: { ...e[i + n + 2][1].end }, end: { ...e[o - 2][1].start } };
	return s = [['enter', a, t], ['enter', c, t]],
		s = we(s, e.slice(i + 1, i + n + 3)),
		s = we(s, [['enter', u, t]]),
		b(t.parser.constructs.insideSpan.null, 'expected `insideSpan.null` to be populated'),
		s = we(s, zt(t.parser.constructs.insideSpan.null, e.slice(i + n + 4, o - 3), t)),
		s = we(s, [['exit', u, t], e[o - 2], e[o - 1], ['exit', c, t]]),
		s = we(s, e.slice(o + 1)),
		s = we(s, [['exit', a, t]]),
		he(e, i, e.length, s),
		e;
}
function VA(e, t, r) {
	let n = this, i = n._labelStarts, o, s;
	if (i) {
		while (i.length > 0 && i[i.length - 1]._balanced) i.pop();
		o = i[i.length - 1];
	}
	return a;
	function a(h) {
		if (b(h === p.rightSquareBracket, 'expected `]`'), !o) return r(h);
		if (o._inactive) return f(h);
		return s = n.parser.defined.includes(ye(n.sliceSerialize({ start: o.end, end: n.now() }))),
			e.enter(m.labelEnd),
			e.enter(m.labelMarker),
			e.consume(h),
			e.exit(m.labelMarker),
			e.exit(m.labelEnd),
			c;
	}
	function c(h) {
		if (h === p.leftParenthesis) return e.attempt(RA, l, s ? l : f)(h);
		if (h === p.leftSquareBracket) return e.attempt(BA, l, s ? u : f)(h);
		return s ? l(h) : f(h);
	}
	function u(h) {
		return e.attempt(ZA, l, f)(h);
	}
	function l(h) {
		return b(i, 'expected `labelStarts` to be populated'), i.pop(), t(h);
	}
	function f(h) {
		return o._balanced = !0, r(h);
	}
}
function KA(e, t, r) {
	return n;
	function n(f) {
		return b(f === p.leftParenthesis, 'expected left paren'),
			e.enter(m.resource),
			e.enter(m.resourceMarker),
			e.consume(f),
			e.exit(m.resourceMarker),
			i;
	}
	function i(f) {
		return G(f) ? Jt(e, o)(f) : o(f);
	}
	function o(f) {
		if (f === p.rightParenthesis) return l(f);
		return bo(
			e,
			s,
			a,
			m.resourceDestination,
			m.resourceDestinationLiteral,
			m.resourceDestinationLiteralMarker,
			m.resourceDestinationRaw,
			m.resourceDestinationString,
			P.linkResourceDestinationBalanceMax,
		)(f);
	}
	function s(f) {
		return G(f) ? Jt(e, c)(f) : l(f);
	}
	function a(f) {
		return r(f);
	}
	function c(f) {
		if (f === p.quotationMark || f === p.apostrophe || f === p.leftParenthesis) {
			return ko(e, u, r, m.resourceTitle, m.resourceTitleMarker, m.resourceTitleString)(f);
		}
		return l(f);
	}
	function u(f) {
		return G(f) ? Jt(e, l)(f) : l(f);
	}
	function l(f) {
		if (f === p.rightParenthesis) {
			return e.enter(m.resourceMarker), e.consume(f), e.exit(m.resourceMarker), e.exit(m.resource), t;
		}
		return r(f);
	}
}
function JA(e, t, r) {
	let n = this;
	return i;
	function i(a) {
		return b(a === p.leftSquareBracket, 'expected left bracket'),
			xo.call(n, e, o, s, m.reference, m.referenceMarker, m.referenceString)(a);
	}
	function o(a) {
		return n.parser.defined.includes(ye(n.sliceSerialize(n.events[n.events.length - 1][1]).slice(1, -1))) ? t(a) : r(a);
	}
	function s(a) {
		return r(a);
	}
}
function HA(e, t, r) {
	return n;
	function n(o) {
		return b(o === p.leftSquareBracket, 'expected left bracket'),
			e.enter(m.reference),
			e.enter(m.referenceMarker),
			e.consume(o),
			e.exit(m.referenceMarker),
			i;
	}
	function i(o) {
		if (o === p.rightSquareBracket) {
			return e.enter(m.referenceMarker), e.consume(o), e.exit(m.referenceMarker), e.exit(m.reference), t;
		}
		return r(o);
	}
}
var yc = { name: 'labelStartImage', resolveAll: Ht.resolveAll, tokenize: GA };
function GA(e, t, r) {
	let n = this, i;
	return o;
	function o(c) {
		return b(c === p.exclamationMark, 'expected `!`'),
			e.enter(m.labelImage),
			e.enter(m.labelImageMarker),
			e.consume(c),
			e.exit(m.labelImageMarker),
			s;
	}
	function s(c) {
		if (c === p.leftSquareBracket) {
			return e.enter(m.labelMarker), e.consume(c), e.exit(m.labelMarker), i = e.exit(m.labelImage), a;
		}
		return r(c);
	}
	function a(c) {
		if (c === p.caret && '_hiddenFootnoteSupport' in n.parser.constructs) return r(c);
		return n._labelStarts = n._labelStarts || [], n._labelStarts.push(i), t(c);
	}
}
var bc = { name: 'labelStartLink', resolveAll: Ht.resolveAll, tokenize: WA };
function WA(e, t, r) {
	let n = this, i;
	return o;
	function o(a) {
		return b(a === p.leftSquareBracket, 'expected `[`'),
			e.enter(m.labelLink),
			e.enter(m.labelMarker),
			e.consume(a),
			e.exit(m.labelMarker),
			i = e.exit(m.labelLink),
			s;
	}
	function s(a) {
		if (a === p.caret && '_hiddenFootnoteSupport' in n.parser.constructs) return r(a);
		return n._labelStarts = n._labelStarts || [], n._labelStarts.push(i), t(a);
	}
}
var Tn = { name: 'lineEnding', tokenize: YA };
function YA(e, t) {
	return r;
	function r(n) {
		return b(N(n), 'expected eol'), e.enter(m.lineEnding), e.consume(n), e.exit(m.lineEnding), j(e, t, m.linePrefix);
	}
}
var Gt = { name: 'thematicBreak', tokenize: QA };
function QA(e, t, r) {
	let n = 0, i;
	return o;
	function o(u) {
		return e.enter(m.thematicBreak), s(u);
	}
	function s(u) {
		return b(u === p.asterisk || u === p.dash || u === p.underscore, 'expected `*`, `-`, or `_`'), i = u, a(u);
	}
	function a(u) {
		if (u === i) return e.enter(m.thematicBreakSequence), c(u);
		if (n >= P.thematicBreakMarkerCountMin && (u === p.eof || N(u))) return e.exit(m.thematicBreak), t(u);
		return r(u);
	}
	function c(u) {
		if (u === i) return e.consume(u), n++, c;
		return e.exit(m.thematicBreakSequence), R(u) ? j(e, a, m.whitespace)(u) : a(u);
	}
}
var be = { continuation: { tokenize: rE }, exit: iE, name: 'list', tokenize: tE },
	XA = { partial: !0, tokenize: oE },
	eE = { partial: !0, tokenize: nE };
function tE(e, t, r) {
	let n = this,
		i = n.events[n.events.length - 1],
		o = i && i[1].type === m.linePrefix ? i[2].sliceSerialize(i[1], !0).length : 0,
		s = 0;
	return a;
	function a(d) {
		b(n.containerState, 'expected state');
		let g = n.containerState.type
			|| (d === p.asterisk || d === p.plusSign || d === p.dash ? m.listUnordered : m.listOrdered);
		if (g === m.listUnordered ? !n.containerState.marker || d === n.containerState.marker : wn(d)) {
			if (!n.containerState.type) n.containerState.type = g, e.enter(g, { _container: !0 });
			if (g === m.listUnordered) {
				return e.enter(m.listItemPrefix), d === p.asterisk || d === p.dash ? e.check(Gt, r, u)(d) : u(d);
			}
			if (!n.interrupt || d === p.digit1) return e.enter(m.listItemPrefix), e.enter(m.listItemValue), c(d);
		}
		return r(d);
	}
	function c(d) {
		if (b(n.containerState, 'expected state'), wn(d) && ++s < P.listItemValueSizeMax) return e.consume(d), c;
		if (
			(!n.interrupt || s < 2)
			&& (n.containerState.marker ? d === n.containerState.marker : d === p.rightParenthesis || d === p.dot)
		) return e.exit(m.listItemValue), u(d);
		return r(d);
	}
	function u(d) {
		return b(n.containerState, 'expected state'),
			b(d !== p.eof, 'eof (`null`) is not a marker'),
			e.enter(m.listItemMarker),
			e.consume(d),
			e.exit(m.listItemMarker),
			n.containerState.marker = n.containerState.marker || d,
			e.check(Xe, n.interrupt ? r : l, e.attempt(XA, h, f));
	}
	function l(d) {
		return b(n.containerState, 'expected state'), n.containerState.initialBlankLine = !0, o++, h(d);
	}
	function f(d) {
		if (R(d)) return e.enter(m.listItemPrefixWhitespace), e.consume(d), e.exit(m.listItemPrefixWhitespace), h;
		return r(d);
	}
	function h(d) {
		return b(n.containerState, 'expected state'),
			n.containerState.size = o + n.sliceSerialize(e.exit(m.listItemPrefix), !0).length,
			t(d);
	}
}
function rE(e, t, r) {
	let n = this;
	return b(n.containerState, 'expected state'), n.containerState._closeFlow = void 0, e.check(Xe, i, o);
	function i(a) {
		return b(n.containerState, 'expected state'),
			b(typeof n.containerState.size === 'number', 'expected size'),
			n.containerState.furtherBlankLines = n.containerState.furtherBlankLines || n.containerState.initialBlankLine,
			j(e, t, m.listItemIndent, n.containerState.size + 1)(a);
	}
	function o(a) {
		if (b(n.containerState, 'expected state'), n.containerState.furtherBlankLines || !R(a)) {
			return n.containerState.furtherBlankLines = void 0, n.containerState.initialBlankLine = void 0, s(a);
		}
		return n.containerState.furtherBlankLines = void 0,
			n.containerState.initialBlankLine = void 0,
			e.attempt(eE, t, s)(a);
	}
	function s(a) {
		return b(n.containerState, 'expected state'),
			n.containerState._closeFlow = !0,
			n.interrupt = void 0,
			b(n.parser.constructs.disable.null, 'expected `disable.null` to be populated'),
			j(
				e,
				e.attempt(be, t, r),
				m.linePrefix,
				n.parser.constructs.disable.null.includes('codeIndented') ? void 0 : P.tabSize,
			)(a);
	}
}
function nE(e, t, r) {
	let n = this;
	return b(n.containerState, 'expected state'),
		b(typeof n.containerState.size === 'number', 'expected size'),
		j(e, i, m.listItemIndent, n.containerState.size + 1);
	function i(o) {
		b(n.containerState, 'expected state');
		let s = n.events[n.events.length - 1];
		return s && s[1].type === m.listItemIndent && s[2].sliceSerialize(s[1], !0).length === n.containerState.size
			? t(o)
			: r(o);
	}
}
function iE(e) {
	b(this.containerState, 'expected state'),
		b(typeof this.containerState.type === 'string', 'expected type'),
		e.exit(this.containerState.type);
}
function oE(e, t, r) {
	let n = this;
	return b(n.parser.constructs.disable.null, 'expected `disable.null` to be populated'),
		j(
			e,
			i,
			m.listItemPrefixWhitespace,
			n.parser.constructs.disable.null.includes('codeIndented') ? void 0 : P.tabSize + 1,
		);
	function i(o) {
		let s = n.events[n.events.length - 1];
		return !R(o) && s && s[1].type === m.listItemPrefixWhitespace ? t(o) : r(o);
	}
}
var So = { name: 'setextUnderline', resolveTo: sE, tokenize: aE };
function sE(e, t) {
	let r = new Ct(), n = e.length, i, o, s;
	while (n--) {
		if (e[n][0] === 'enter') {
			if (e[n][1].type === m.content) {
				i = n;
				break;
			}
			if (e[n][1].type === m.paragraph) o = n;
		} else {
			if (e[n][1].type === m.content) r.add(n, 1, []);
			if (!s && e[n][1].type === m.definition) s = n;
		}
	}
	b(o !== void 0, 'expected a `text` index to be found'),
		b(i !== void 0, 'expected a `text` index to be found'),
		b(e[i][2] === t, 'enter context should be same'),
		b(e[e.length - 1][2] === t, 'enter context should be same');
	let a = { type: m.setextHeading, start: { ...e[i][1].start }, end: { ...e[e.length - 1][1].end } };
	if (e[o][1].type = m.setextHeadingText, s) {
		r.add(o, 0, [['enter', a, t]]), r.add(s + 1, 0, [['exit', e[i][1], t]]), e[i][1].end = { ...e[s][1].end };
	} else e[i][1] = a;
	return r.add(e.length, 0, [['exit', a, t]]), r.consume(e), e;
}
function aE(e, t, r) {
	let n = this, i;
	return o;
	function o(u) {
		let l = n.events.length, f;
		b(u === p.dash || u === p.equalsTo, 'expected `=` or `-`');
		while (l--) {
			if (
				n.events[l][1].type !== m.lineEnding && n.events[l][1].type !== m.linePrefix
				&& n.events[l][1].type !== m.content
			) {
				f = n.events[l][1].type === m.paragraph;
				break;
			}
		}
		if (!n.parser.lazy[n.now().line] && (n.interrupt || f)) return e.enter(m.setextHeadingLine), i = u, s(u);
		return r(u);
	}
	function s(u) {
		return e.enter(m.setextHeadingLineSequence), a(u);
	}
	function a(u) {
		if (u === i) return e.consume(u), a;
		return e.exit(m.setextHeadingLineSequence), R(u) ? j(e, c, m.lineSuffix)(u) : c(u);
	}
	function c(u) {
		if (u === p.eof || N(u)) return e.exit(m.setextHeadingLine), t(u);
		return r(u);
	}
}
var qg = { tokenize: cE };
function cE(e) {
	let t = this,
		r = e.attempt(
			Xe,
			n,
			e.attempt(
				this.parser.constructs.flowInitial,
				i,
				j(e, e.attempt(this.parser.constructs.flow, i, e.attempt(fc, i)), m.linePrefix),
			),
		);
	return r;
	function n(o) {
		if (b(o === p.eof || N(o), 'expected eol or eof'), o === p.eof) {
			e.consume(o);
			return;
		}
		return e.enter(m.lineEndingBlank), e.consume(o), e.exit(m.lineEndingBlank), t.currentConstruct = void 0, r;
	}
	function i(o) {
		if (b(o === p.eof || N(o), 'expected eol or eof'), o === p.eof) {
			e.consume(o);
			return;
		}
		return e.enter(m.lineEnding), e.consume(o), e.exit(m.lineEnding), t.currentConstruct = void 0, r;
	}
}
var Dg = { resolveAll: Bg() }, Mg = Rg('string'), Fg = Rg('text');
function Rg(e) {
	return { resolveAll: Bg(e === 'text' ? uE : void 0), tokenize: t };
	function t(r) {
		let n = this, i = this.parser.constructs[e], o = r.attempt(i, s, a);
		return s;
		function s(l) {
			return u(l) ? o(l) : a(l);
		}
		function a(l) {
			if (l === p.eof) {
				r.consume(l);
				return;
			}
			return r.enter(m.data), r.consume(l), c;
		}
		function c(l) {
			if (u(l)) return r.exit(m.data), o(l);
			return r.consume(l), c;
		}
		function u(l) {
			if (l === p.eof) return !0;
			let f = i[l], h = -1;
			if (f) {
				b(Array.isArray(f), 'expected `disable.null` to be populated');
				while (++h < f.length) {
					let d = f[h];
					if (!d.previous || d.previous.call(n, n.previous)) return !0;
				}
			}
			return !1;
		}
	}
}
function Bg(e) {
	return t;
	function t(r, n) {
		let i = -1, o;
		while (++i <= r.length) {
			if (o === void 0) { if (r[i] && r[i][1].type === m.data) o = i, i++; }
			else if (!r[i] || r[i][1].type !== m.data) {
				if (i !== o + 2) r[o][1].end = r[i - 1][1].end, r.splice(o + 2, i - o - 2), i = o + 2;
				o = void 0;
			}
		}
		return e ? e(r, n) : r;
	}
}
function uE(e, t) {
	let r = new Ct(), n = 0;
	while (++n <= e.length) {
		if ((n === e.length || e[n][1].type === m.lineEnding) && e[n - 1][1].type === m.data) {
			let i = e[n - 1][1], o = t.sliceStream(i), s = o.length, a = -1, c = 0, u;
			while (s--) {
				let l = o[s];
				if (typeof l === 'string') {
					a = l.length;
					while (l.charCodeAt(a - 1) === p.space) c++, a--;
					if (a) break;
					a = -1;
				} else if (l === p.horizontalTab) u = !0, c++;
				else if (l === p.virtualSpace);
				else {
					s++;
					break;
				}
			}
			if (t._contentTypeTextTrailing && n === e.length) c = 0;
			if (c) {
				let l = {
					type: n === e.length || u || c < P.hardBreakPrefixSizeMin ? m.lineSuffix : m.hardBreakTrailing,
					start: {
						_bufferIndex: s ? a : i.start._bufferIndex + a,
						_index: i.start._index + s,
						line: i.end.line,
						column: i.end.column - c,
						offset: i.end.offset - c,
					},
					end: { ...i.end },
				};
				if (i.end = { ...l.start }, i.start.offset === i.end.offset) Object.assign(i, l);
				else r.add(n, 0, [['enter', l, t], ['exit', l, t]]);
			}
			n++;
		}
	}
	return r.consume(e), e;
}
var lE = {
		[p.asterisk]: be,
		[p.plusSign]: be,
		[p.dash]: be,
		[p.digit0]: be,
		[p.digit1]: be,
		[p.digit2]: be,
		[p.digit3]: be,
		[p.digit4]: be,
		[p.digit5]: be,
		[p.digit6]: be,
		[p.digit7]: be,
		[p.digit8]: be,
		[p.digit9]: be,
		[p.greaterThan]: po,
	},
	fE = { [p.leftSquareBracket]: pc },
	pE = { [p.horizontalTab]: _n, [p.virtualSpace]: _n, [p.space]: _n },
	hE = {
		[p.numberSign]: dc,
		[p.asterisk]: Gt,
		[p.dash]: [So, Gt],
		[p.lessThan]: mc,
		[p.equalsTo]: So,
		[p.underscore]: Gt,
		[p.graveAccent]: go,
		[p.tilde]: go,
	},
	dE = { [p.ampersand]: mo, [p.backslash]: ho },
	mE = {
		[p.carriageReturn]: Tn,
		[p.lineFeed]: Tn,
		[p.carriageReturnLineFeed]: Tn,
		[p.exclamationMark]: yc,
		[p.ampersand]: mo,
		[p.asterisk]: Sn,
		[p.lessThan]: [cc, gc],
		[p.leftSquareBracket]: bc,
		[p.backslash]: [hc, ho],
		[p.rightSquareBracket]: Ht,
		[p.underscore]: Sn,
		[p.graveAccent]: uc,
	},
	gE = { null: [Sn, Dg] },
	yE = { null: [p.asterisk, p.underscore] },
	bE = { null: [] };
var ey = Xu(Xg(), 1);
var Qt = ey.default('micromark');
function ty(e, t, r) {
	let n = {
			_bufferIndex: -1,
			_index: 0,
			line: r && r.line || 1,
			column: r && r.column || 1,
			offset: r && r.offset || 0,
		},
		i = {},
		o = [],
		s = [],
		a = [],
		c = !0,
		u = { attempt: U(q), check: U(L), consume: O, enter: I, exit: v, interrupt: U(L, { interrupt: !0 }) },
		l = {
			code: p.eof,
			containerState: {},
			defineSkip: k,
			events: [],
			now: x,
			parser: e,
			previous: p.eof,
			sliceSerialize: g,
			sliceStream: y,
			write: d,
		},
		f = t.tokenize.call(l, u),
		h;
	if (t.resolveAll) o.push(t);
	return l;
	function d(M) {
		if (s = we(s, M), z(), s[s.length - 1] !== p.eof) return [];
		return C(t, 0), l.events = zt(o, l.events, l), l.events;
	}
	function g(M, V) {
		return oI(y(M), V);
	}
	function y(M) {
		return iI(s, M);
	}
	function x() {
		let { _bufferIndex: M, _index: V, line: H, column: ne, offset: ue } = n;
		return { _bufferIndex: M, _index: V, line: H, column: ne, offset: ue };
	}
	function k(M) {
		i[M.line] = M.column, Z(), Qt('position: define skip: `%j`', n);
	}
	function z() {
		while (n._index < s.length) {
			let M = s[n._index];
			if (typeof M === 'string') {
				let V = n._index;
				if (n._bufferIndex < 0) n._bufferIndex = 0;
				while (n._index === V && n._bufferIndex < M.length) _(M.charCodeAt(n._bufferIndex));
			} else _(M);
		}
	}
	function _(M) {
		b(c === !0, 'expected character to be consumed'),
			c = void 0,
			Qt('main: passing `%s` to %s', M, f && f.name),
			h = M,
			b(typeof f === 'function', 'expected state'),
			f = f(M);
	}
	function O(M) {
		if (
			b(M === h, 'expected given code to equal expected code'),
				Qt('consume: `%s`', M),
				b(
					c === void 0,
					'expected code to not have been consumed: this might be because `return x(code)` instead of `return x` was used',
				),
				b(
					M === null
						? l.events.length === 0 || l.events[l.events.length - 1][0] === 'exit'
						: l.events[l.events.length - 1][0] === 'enter',
					'expected last token to be open',
				),
				N(M)
		) {
			n.line++,
				n.column = 1,
				n.offset += M === p.carriageReturnLineFeed ? 2 : 1,
				Z(),
				Qt('position: after eol: `%j`', n);
		} else if (M !== p.virtualSpace) n.column++, n.offset++;
		if (n._bufferIndex < 0) n._index++;
		else if (n._bufferIndex++, n._bufferIndex === s[n._index].length) n._bufferIndex = -1, n._index++;
		l.previous = M, c = !0;
	}
	function I(M, V) {
		let H = V || {};
		return H.type = M,
			H.start = x(),
			b(typeof M === 'string', 'expected string type'),
			b(M.length > 0, 'expected non-empty string'),
			Qt('enter: `%s`', M),
			l.events.push(['enter', H, l]),
			a.push(H),
			H;
	}
	function v(M) {
		b(typeof M === 'string', 'expected string type'), b(M.length > 0, 'expected non-empty string');
		let V = a.pop();
		return b(V, 'cannot close w/o open tokens'),
			V.end = x(),
			b(M === V.type, 'expected exit token to match current token'),
			b(
				!(V.start._index === V.end._index && V.start._bufferIndex === V.end._bufferIndex),
				'expected non-empty token (`' + M + '`)',
			),
			Qt('exit: `%s`', V.type),
			l.events.push(['exit', V, l]),
			V;
	}
	function q(M, V) {
		C(M, V.from);
	}
	function L(M, V) {
		V.restore();
	}
	function U(M, V) {
		return H;
		function H(ne, ue, Ie) {
			let Ue, w, Pe, tt;
			return Array.isArray(ne) ? _e(ne) : ('tokenize' in ne) ? _e([ne]) : S(ne);
			function S(le) {
				return $r;
				function $r(rt) {
					let ir = rt !== null && le[rt],
						$t = rt !== null && le.null,
						Go = [...Array.isArray(ir) ? ir : ir ? [ir] : [], ...Array.isArray($t) ? $t : $t ? [$t] : []];
					return _e(Go)(rt);
				}
			}
			function _e(le) {
				if (Ue = le, w = 0, le.length === 0) return b(Ie, 'expected `bogusState` to be given'), Ie;
				return nr(le[w]);
			}
			function nr(le) {
				return $r;
				function $r(rt) {
					if (tt = J(), Pe = le, !le.partial) l.currentConstruct = le;
					if (
						b(l.parser.constructs.disable.null, 'expected `disable.null` to be populated'),
							le.name && l.parser.constructs.disable.null.includes(le.name)
					) return Mn(rt);
					return le.tokenize.call(V ? Object.assign(Object.create(l), V) : l, u, Dn, Mn)(rt);
				}
			}
			function Dn(le) {
				return b(le === h, 'expected code'), c = !0, M(Pe, tt), ue;
			}
			function Mn(le) {
				if (b(le === h, 'expected code'), c = !0, tt.restore(), ++w < Ue.length) return nr(Ue[w]);
				return Ie;
			}
		}
	}
	function C(M, V) {
		if (M.resolveAll && !o.includes(M)) o.push(M);
		if (M.resolve) he(l.events, V, l.events.length - V, M.resolve(l.events.slice(V), l));
		if (M.resolveTo) l.events = M.resolveTo(l.events, l);
		b(M.partial || l.events.length === 0 || l.events[l.events.length - 1][0] === 'exit', 'expected last token to end');
	}
	function J() {
		let M = x(), { previous: V, currentConstruct: H } = l, ne = l.events.length, ue = Array.from(a);
		return { from: ne, restore: Ie };
		function Ie() {
			n = M,
				l.previous = V,
				l.currentConstruct = H,
				l.events.length = ne,
				a = ue,
				Z(),
				Qt('position: restore: `%j`', n);
		}
	}
	function Z() {
		if (n.line in i && n.column < 2) n.column = i[n.line], n.offset += i[n.line] - 1;
	}
}
function iI(e, t) {
	let r = t.start._index, n = t.start._bufferIndex, i = t.end._index, o = t.end._bufferIndex, s;
	if (r === i) {
		b(o > -1, 'expected non-negative end buffer index'),
			b(n > -1, 'expected non-negative start buffer index'),
			s = [e[r].slice(n, o)];
	} else {
		if (s = e.slice(r, i), n > -1) {
			let a = s[0];
			if (typeof a === 'string') s[0] = a.slice(n);
			else b(n === 0, 'expected `startBufferIndex` to be `0`'), s.shift();
		}
		if (o > 0) s.push(e[i].slice(0, o));
	}
	return s;
}
function oI(e, t) {
	let r = -1, n = [], i;
	while (++r < e.length) {
		let o = e[r], s;
		if (typeof o === 'string') s = o;
		else {switch (o) {
				case p.carriageReturn: {
					s = Ee.cr;
					break;
				}
				case p.lineFeed: {
					s = Ee.lf;
					break;
				}
				case p.carriageReturnLineFeed: {
					s = Ee.cr + Ee.lf;
					break;
				}
				case p.horizontalTab: {
					s = t ? Ee.space : Ee.ht;
					break;
				}
				case p.virtualSpace: {
					if (!t && i) continue;
					s = Ee.space;
					break;
				}
				default:
					b(typeof o === 'number', 'expected number'), s = String.fromCharCode(o);
			}}
		i = o === p.horizontalTab, n.push(s);
	}
	return n.join('');
}
function zc(e) {
	let n = {
		constructs: uo([xc, ...(e || {}).extensions || []]),
		content: i(Ig),
		defined: [],
		document: i($g),
		flow: i(qg),
		lazy: {},
		string: i(Mg),
		text: i(Fg),
	};
	return n;
	function i(o) {
		return s;
		function s(a) {
			return ty(n, o, a);
		}
	}
}
function Tc(e) {
	while (!yo(e));
	return e;
}
var ry = /[\0\t\n\r]/g;
function Ac() {
	let e = 1, t = '', r = !0, n;
	return i;
	function i(o, s, a) {
		o = t + (typeof o === 'string' ? o.toString() : new TextDecoder(s || void 0).decode(o));
		let c = [], u = 0;
		if (t = '', r) {
			if (o.charCodeAt(0) === p.byteOrderMarker) u++;
			r = void 0;
		}
		while (u < o.length) {
			ry.lastIndex = u;
			let l = ry.exec(o), f = l && l.index !== void 0 ? l.index : o.length, h = o.charCodeAt(f);
			if (!l) {
				t = o.slice(u);
				break;
			}
			if (h === p.lf && u === f && n) c.push(p.carriageReturnLineFeed), n = void 0;
			else {
				if (n) c.push(p.carriageReturn), n = void 0;
				if (u < f) c.push(o.slice(u, f)), e += f - u;
				switch (h) {
					case p.nul: {
						c.push(p.replacementCharacter), e++;
						break;
					}
					case p.ht: {
						let d = Math.ceil(e / P.tabSize) * P.tabSize;
						c.push(p.horizontalTab);
						while (e++ < d) c.push(p.virtualSpace);
						break;
					}
					case p.lf: {
						c.push(p.lineFeed), e = 1;
						break;
					}
					default:
						n = !0, e = 1;
				}
			}
			u = f + 1;
		}
		if (a) {
			if (n) c.push(p.carriageReturn);
			if (t) c.push(t);
			c.push(p.eof);
		}
		return c;
	}
}
var sI = /\\([!-/:-@[-`{-~])|&(#(?:\d{1,7}|x[\da-f]{1,6})|[\da-z]{1,31});/gi;
function To(e) {
	return e.replace(sI, aI);
}
function aI(e, t, r) {
	if (t) return t;
	if (r.charCodeAt(0) === p.numberSign) {
		let i = r.charCodeAt(1), o = i === p.lowercaseX || i === p.uppercaseX;
		return lo(r.slice(o ? 2 : 1), o ? P.numericBaseHexadecimal : P.numericBaseDecimal);
	}
	return vr(r) || e;
}
function At(e) {
	if (!e || typeof e !== 'object') return '';
	if ('position' in e || 'type' in e) return ny(e.position);
	if ('start' in e || 'end' in e) return ny(e);
	if ('line' in e || 'column' in e) return Ec(e);
	return '';
}
function Ec(e) {
	return iy(e && e.line) + ':' + iy(e && e.column);
}
function ny(e) {
	return Ec(e && e.start) + '-' + Ec(e && e.end);
}
function iy(e) {
	return e && typeof e === 'number' ? e : 1;
}
var sy = {}.hasOwnProperty;
function Ic(e, t, r) {
	if (t && typeof t === 'object') r = t, t = void 0;
	return cI(r)(Tc(zc(r).document().write(Ac()(e, t, !0))));
}
function cI(e) {
	let t = {
		afterExit: [],
		beforeEnter: [],
		transforms: [],
		canContainEols: ['emphasis', 'fragment', 'heading', 'paragraph', 'strong'],
		enter: {
			autolink: s(Ju),
			autolinkProtocol: C,
			autolinkEmail: C,
			atxHeading: s(Uu),
			blockQuote: s(ir),
			characterEscape: C,
			characterReference: C,
			codeFenced: s($t),
			codeFencedFenceInfo: a,
			codeFencedFenceMeta: a,
			codeIndented: s($t, a),
			codeText: s(Go, a),
			codeTextData: C,
			data: C,
			codeFlowValue: C,
			definition: s(Mb),
			definitionDestinationString: a,
			definitionLabelString: a,
			definitionTitleString: a,
			emphasis: s(Fb),
			hardBreakEscape: s(Vu),
			hardBreakTrailing: s(Vu),
			htmlFlow: s(Ku, a),
			htmlFlowData: C,
			htmlText: s(Ku, a),
			htmlTextData: C,
			image: s(Rb),
			label: a,
			link: s(Ju),
			listItem: s(Bb),
			listItemValue: d,
			listOrdered: s(Hu, h),
			listUnordered: s(Hu),
			paragraph: s(Zb),
			reference: _e,
			referenceString: a,
			resourceDestinationString: a,
			resourceTitleString: a,
			setextHeading: s(Uu),
			strong: s(jb),
			thematicBreak: s(Vb),
		},
		exit: {
			atxHeading: u(),
			atxHeadingSequence: v,
			autolink: u(),
			autolinkEmail: rt,
			autolinkProtocol: $r,
			blockQuote: u(),
			characterEscapeValue: J,
			characterReferenceMarkerHexadecimal: Dn,
			characterReferenceMarkerNumeric: Dn,
			characterReferenceValue: Mn,
			characterReference: le,
			codeFenced: u(k),
			codeFencedFence: x,
			codeFencedFenceInfo: g,
			codeFencedFenceMeta: y,
			codeFlowValue: J,
			codeIndented: u(z),
			codeText: u(ne),
			codeTextData: J,
			data: J,
			definition: u(),
			definitionDestinationString: I,
			definitionLabelString: _,
			definitionTitleString: O,
			emphasis: u(),
			hardBreakEscape: u(M),
			hardBreakTrailing: u(M),
			htmlFlow: u(V),
			htmlFlowData: J,
			htmlText: u(H),
			htmlTextData: J,
			image: u(Ie),
			label: w,
			labelText: Ue,
			lineEnding: Z,
			link: u(ue),
			listItem: u(),
			listOrdered: u(),
			listUnordered: u(),
			paragraph: u(),
			referenceString: nr,
			resourceDestinationString: Pe,
			resourceTitleString: tt,
			resource: S,
			setextHeading: u(U),
			setextHeadingLineSequence: L,
			setextHeadingText: q,
			strong: u(),
			thematicBreak: u(),
		},
	};
	ay(t, (e || {}).mdastExtensions || []);
	let r = {};
	return n;
	function n(T) {
		let A = { type: 'root', children: [], position: void 0 },
			F = { stack: [A], tokenStack: [], config: t, enter: c, exit: l, buffer: a, resume: f, data: r },
			K = [],
			ge = [],
			X = -1;
		while (++X < T.length) {
			if (ge.push(T[X]), T[X][1].type === m.listOrdered || T[X][1].type === m.listUnordered) {
				if (T[X][0] === 'enter') K.push(ge.length - 1);
				else {
					let xe = K.pop();
					b(typeof xe === 'number', 'expected list to be open'), o(ge, xe);
				}
			}
		}
		T = ge, X = -1;
		while (++X < T.length) {
			let xe = t[T[X][0]];
			if (T[X][0] === 'enter' && t.beforeEnter.length > 0) {
				i(t.beforeEnter, { ...F, sliceSerialize: T[X][2].sliceSerialize }, T[X][1]);
			}
			if (sy.call(xe, T[X][1].type)) xe[T[X][1].type].call({ ...F, sliceSerialize: T[X][2].sliceSerialize }, T[X][1]);
			if (T[X][0] === 'exit' && t.afterExit.length > 0) {
				i(t.afterExit, { ...F, sliceSerialize: T[X][2].sliceSerialize }, T[X][1]);
			}
		}
		if (F.tokenStack.length > 0) {
			let xe = F.tokenStack[F.tokenStack.length - 1];
			(xe[1] || oy).call(F, void 0, xe[0]);
		}
		A.position = {
			start: Et(T.length > 0 ? T[0][1].start : { line: 1, column: 1, offset: 0 }),
			end: Et(T.length > 0 ? T[T.length - 2][1].end : { line: 1, column: 1, offset: 0 }),
		}, X = -1;
		while (++X < t.transforms.length) A = t.transforms[X](A) || A;
		return A;
	}
	function i(T, A, F) {
		let K = -1;
		while (++K < T.length) T[K].call(A, F);
	}
	function o(T, A) {
		let F = T.length - 1, K = A - 1, ge = -1, X = !1, xe, Ve, Lr, Nr, or = [];
		while (++K <= F) {
			let Ce = T[K];
			switch (Ce[1].type) {
				case m.listUnordered:
				case m.listOrdered:
				case m.blockQuote: {
					if (Ce[0] === 'enter') ge++;
					else ge--;
					Nr = void 0;
					break;
				}
				case m.lineEndingBlank: {
					if (Ce[0] === 'enter') {
						if (xe && !Nr && !ge && !Lr) Lr = K;
						Nr = void 0;
					}
					break;
				}
				case m.linePrefix:
				case m.listItemValue:
				case m.listItemMarker:
				case m.listItemPrefix:
				case m.listItemPrefixWhitespace:
					break;
				default:
					Nr = void 0;
			}
			if (
				!ge && Ce[0] === 'enter' && Ce[1].type === m.listItemPrefix
				|| ge === -1 && Ce[0] === 'exit' && (Ce[1].type === m.listUnordered || Ce[1].type === m.listOrdered)
			) {
				if (xe) {
					let sr = K;
					Ve = void 0;
					while (sr--) {
						let nt = T[sr];
						if (nt[1].type === m.lineEnding || nt[1].type === m.lineEndingBlank) {
							if (nt[0] === 'exit') continue;
							if (Ve) T[Ve][1].type = m.lineEndingBlank, X = !0;
							nt[1].type = m.lineEnding, Ve = sr;
						} else if (
							nt[1].type === m.linePrefix || nt[1].type === m.blockQuotePrefix
							|| nt[1].type === m.blockQuotePrefixWhitespace || nt[1].type === m.blockQuoteMarker
							|| nt[1].type === m.listItemIndent
						);
						else break;
					}
					if (Lr && (!Ve || Lr < Ve)) xe._spread = !0;
					xe.end = Object.assign({}, Ve ? T[Ve][1].start : Ce[1].end),
						or.push({ at: Ve || K, event: ['exit', xe, Ce[2]] });
				}
				if (Ce[1].type === m.listItemPrefix) {
					let sr = { type: 'listItem', _spread: !1, start: Object.assign({}, Ce[1].start), end: void 0 };
					xe = sr, or.push({ at: K, event: ['enter', sr, Ce[2]] }), Lr = void 0, Nr = !0;
				}
			}
		}
		let Gu = T.splice(A), Fn = 0;
		K = -1;
		while (++K < Gu.length) {
			while (Fn < or.length && or[Fn].at === A + K) T.push(or[Fn++].event);
			T.push(Gu[K]);
		}
		b(Fn === or.length, 'expected insertions to be merged'), T[A][1]._spread = X;
	}
	function s(T, A) {
		return F;
		function F(K) {
			if (c.call(this, T(K), K), A) A.call(this, K);
		}
	}
	function a() {
		this.stack.push({ type: 'fragment', children: [] });
	}
	function c(T, A, F) {
		let K = this.stack[this.stack.length - 1];
		b(K, 'expected `parent`'),
			b('children' in K, 'expected `parent`'),
			K.children.push(T),
			this.stack.push(T),
			this.tokenStack.push([A, F || void 0]),
			T.position = { start: Et(A.start), end: void 0 };
	}
	function u(T) {
		return A;
		function A(F) {
			if (T) T.call(this, F);
			l.call(this, F);
		}
	}
	function l(T, A) {
		let F = this.stack.pop();
		b(F, 'expected `node`');
		let K = this.tokenStack.pop();
		if (!K) throw Error('Cannot close `' + T.type + '` (' + At({ start: T.start, end: T.end }) + '): it’s not open');
		if (K[0].type !== T.type) {
			if (A) A.call(this, T, K[0]);
			else (K[1] || oy).call(this, T, K[0]);
		}
		b(F.type !== 'fragment', 'unexpected fragment `exit`ed'),
			b(F.position, 'expected `position` to be defined'),
			F.position.end = Et(T.end);
	}
	function f() {
		return Ut(this.stack.pop());
	}
	function h() {
		this.data.expectingFirstListItemValue = !0;
	}
	function d(T) {
		if (this.data.expectingFirstListItemValue) {
			let A = this.stack[this.stack.length - 2];
			b(A, 'expected nodes on stack'),
				b(A.type === 'list', 'expected list on stack'),
				A.start = Number.parseInt(this.sliceSerialize(T), P.numericBaseDecimal),
				this.data.expectingFirstListItemValue = void 0;
		}
	}
	function g() {
		let T = this.resume(), A = this.stack[this.stack.length - 1];
		b(A, 'expected node on stack'), b(A.type === 'code', 'expected code on stack'), A.lang = T;
	}
	function y() {
		let T = this.resume(), A = this.stack[this.stack.length - 1];
		b(A, 'expected node on stack'), b(A.type === 'code', 'expected code on stack'), A.meta = T;
	}
	function x() {
		if (this.data.flowCodeInside) return;
		this.buffer(), this.data.flowCodeInside = !0;
	}
	function k() {
		let T = this.resume(), A = this.stack[this.stack.length - 1];
		b(A, 'expected node on stack'),
			b(A.type === 'code', 'expected code on stack'),
			A.value = T.replace(/^(\r?\n|\r)|(\r?\n|\r)$/g, ''),
			this.data.flowCodeInside = void 0;
	}
	function z() {
		let T = this.resume(), A = this.stack[this.stack.length - 1];
		b(A, 'expected node on stack'),
			b(A.type === 'code', 'expected code on stack'),
			A.value = T.replace(/(\r?\n|\r)$/g, '');
	}
	function _(T) {
		let A = this.resume(), F = this.stack[this.stack.length - 1];
		b(F, 'expected node on stack'),
			b(F.type === 'definition', 'expected definition on stack'),
			F.label = A,
			F.identifier = ye(this.sliceSerialize(T)).toLowerCase();
	}
	function O() {
		let T = this.resume(), A = this.stack[this.stack.length - 1];
		b(A, 'expected node on stack'), b(A.type === 'definition', 'expected definition on stack'), A.title = T;
	}
	function I() {
		let T = this.resume(), A = this.stack[this.stack.length - 1];
		b(A, 'expected node on stack'), b(A.type === 'definition', 'expected definition on stack'), A.url = T;
	}
	function v(T) {
		let A = this.stack[this.stack.length - 1];
		if (b(A, 'expected node on stack'), b(A.type === 'heading', 'expected heading on stack'), !A.depth) {
			let F = this.sliceSerialize(T).length;
			b(F === 1 || F === 2 || F === 3 || F === 4 || F === 5 || F === 6, 'expected `depth` between `1` and `6`'),
				A.depth = F;
		}
	}
	function q() {
		this.data.setextHeadingSlurpLineEnding = !0;
	}
	function L(T) {
		let A = this.stack[this.stack.length - 1];
		b(A, 'expected node on stack'),
			b(A.type === 'heading', 'expected heading on stack'),
			A.depth = this.sliceSerialize(T).codePointAt(0) === p.equalsTo ? 1 : 2;
	}
	function U() {
		this.data.setextHeadingSlurpLineEnding = void 0;
	}
	function C(T) {
		let A = this.stack[this.stack.length - 1];
		b(A, 'expected node on stack'), b('children' in A, 'expected parent on stack');
		let F = A.children, K = F[F.length - 1];
		if (!K || K.type !== 'text') K = Ub(), K.position = { start: Et(T.start), end: void 0 }, F.push(K);
		this.stack.push(K);
	}
	function J(T) {
		let A = this.stack.pop();
		b(A, 'expected a `node` to be on the stack'),
			b('value' in A, 'expected a `literal` to be on the stack'),
			b(A.position, 'expected `node` to have an open position'),
			A.value += this.sliceSerialize(T),
			A.position.end = Et(T.end);
	}
	function Z(T) {
		let A = this.stack[this.stack.length - 1];
		if (b(A, 'expected `node`'), this.data.atHardBreak) {
			b('children' in A, 'expected `parent`');
			let F = A.children[A.children.length - 1];
			b(F.position, 'expected tail to have a starting position'),
				F.position.end = Et(T.end),
				this.data.atHardBreak = void 0;
			return;
		}
		if (!this.data.setextHeadingSlurpLineEnding && t.canContainEols.includes(A.type)) C.call(this, T), J.call(this, T);
	}
	function M() {
		this.data.atHardBreak = !0;
	}
	function V() {
		let T = this.resume(), A = this.stack[this.stack.length - 1];
		b(A, 'expected node on stack'), b(A.type === 'html', 'expected html on stack'), A.value = T;
	}
	function H() {
		let T = this.resume(), A = this.stack[this.stack.length - 1];
		b(A, 'expected node on stack'), b(A.type === 'html', 'expected html on stack'), A.value = T;
	}
	function ne() {
		let T = this.resume(), A = this.stack[this.stack.length - 1];
		b(A, 'expected node on stack'), b(A.type === 'inlineCode', 'expected inline code on stack'), A.value = T;
	}
	function ue() {
		let T = this.stack[this.stack.length - 1];
		if (b(T, 'expected node on stack'), b(T.type === 'link', 'expected link on stack'), this.data.inReference) {
			let A = this.data.referenceType || 'shortcut';
			T.type += 'Reference', T.referenceType = A, delete T.url, delete T.title;
		} else delete T.identifier, delete T.label;
		this.data.referenceType = void 0;
	}
	function Ie() {
		let T = this.stack[this.stack.length - 1];
		if (b(T, 'expected node on stack'), b(T.type === 'image', 'expected image on stack'), this.data.inReference) {
			let A = this.data.referenceType || 'shortcut';
			T.type += 'Reference', T.referenceType = A, delete T.url, delete T.title;
		} else delete T.identifier, delete T.label;
		this.data.referenceType = void 0;
	}
	function Ue(T) {
		let A = this.sliceSerialize(T), F = this.stack[this.stack.length - 2];
		b(F, 'expected ancestor on stack'),
			b(F.type === 'image' || F.type === 'link', 'expected image or link on stack'),
			F.label = To(A),
			F.identifier = ye(A).toLowerCase();
	}
	function w() {
		let T = this.stack[this.stack.length - 1];
		b(T, 'expected node on stack'), b(T.type === 'fragment', 'expected fragment on stack');
		let A = this.resume(), F = this.stack[this.stack.length - 1];
		if (
			b(F, 'expected node on stack'),
				b(F.type === 'image' || F.type === 'link', 'expected image or link on stack'),
				this.data.inReference = !0,
				F.type === 'link'
		) {
			let K = T.children;
			F.children = K;
		} else F.alt = A;
	}
	function Pe() {
		let T = this.resume(), A = this.stack[this.stack.length - 1];
		b(A, 'expected node on stack'),
			b(A.type === 'image' || A.type === 'link', 'expected image or link on stack'),
			A.url = T;
	}
	function tt() {
		let T = this.resume(), A = this.stack[this.stack.length - 1];
		b(A, 'expected node on stack'),
			b(A.type === 'image' || A.type === 'link', 'expected image or link on stack'),
			A.title = T;
	}
	function S() {
		this.data.inReference = void 0;
	}
	function _e() {
		this.data.referenceType = 'collapsed';
	}
	function nr(T) {
		let A = this.resume(), F = this.stack[this.stack.length - 1];
		b(F, 'expected node on stack'),
			b(F.type === 'image' || F.type === 'link', 'expected image reference or link reference on stack'),
			F.label = A,
			F.identifier = ye(this.sliceSerialize(T)).toLowerCase(),
			this.data.referenceType = 'full';
	}
	function Dn(T) {
		b(T.type === 'characterReferenceMarkerNumeric' || T.type === 'characterReferenceMarkerHexadecimal'),
			this.data.characterReferenceType = T.type;
	}
	function Mn(T) {
		let A = this.sliceSerialize(T), F = this.data.characterReferenceType, K;
		if (F) {
			K = lo(A, F === m.characterReferenceMarkerNumeric ? P.numericBaseDecimal : P.numericBaseHexadecimal),
				this.data.characterReferenceType = void 0;
		} else {
			let X = vr(A);
			b(X !== !1, 'expected reference to decode'), K = X;
		}
		let ge = this.stack[this.stack.length - 1];
		b(ge, 'expected `node`'), b('value' in ge, 'expected `node.value`'), ge.value += K;
	}
	function le(T) {
		let A = this.stack.pop();
		b(A, 'expected `node`'), b(A.position, 'expected `node.position`'), A.position.end = Et(T.end);
	}
	function $r(T) {
		J.call(this, T);
		let A = this.stack[this.stack.length - 1];
		b(A, 'expected node on stack'), b(A.type === 'link', 'expected link on stack'), A.url = this.sliceSerialize(T);
	}
	function rt(T) {
		J.call(this, T);
		let A = this.stack[this.stack.length - 1];
		b(A, 'expected node on stack'),
			b(A.type === 'link', 'expected link on stack'),
			A.url = 'mailto:' + this.sliceSerialize(T);
	}
	function ir() {
		return { type: 'blockquote', children: [], position: void 0 };
	}
	function $t() {
		return { type: 'code', lang: null, meta: null, value: '', position: void 0 };
	}
	function Go() {
		return { type: 'inlineCode', value: '', position: void 0 };
	}
	function Mb() {
		return { type: 'definition', identifier: '', label: null, title: null, url: '', position: void 0 };
	}
	function Fb() {
		return { type: 'emphasis', children: [], position: void 0 };
	}
	function Uu() {
		return { type: 'heading', depth: 0, children: [], position: void 0 };
	}
	function Vu() {
		return { type: 'break', position: void 0 };
	}
	function Ku() {
		return { type: 'html', value: '', position: void 0 };
	}
	function Rb() {
		return { type: 'image', title: null, url: '', alt: null, position: void 0 };
	}
	function Ju() {
		return { type: 'link', title: null, url: '', children: [], position: void 0 };
	}
	function Hu(T) {
		return {
			type: 'list',
			ordered: T.type === 'listOrdered',
			start: null,
			spread: T._spread,
			children: [],
			position: void 0,
		};
	}
	function Bb(T) {
		return { type: 'listItem', spread: T._spread, checked: null, children: [], position: void 0 };
	}
	function Zb() {
		return { type: 'paragraph', children: [], position: void 0 };
	}
	function jb() {
		return { type: 'strong', children: [], position: void 0 };
	}
	function Ub() {
		return { type: 'text', value: '', position: void 0 };
	}
	function Vb() {
		return { type: 'thematicBreak', position: void 0 };
	}
}
function Et(e) {
	return { line: e.line, column: e.column, offset: e.offset };
}
function ay(e, t) {
	let r = -1;
	while (++r < t.length) {
		let n = t[r];
		if (Array.isArray(n)) ay(e, n);
		else uI(e, n);
	}
}
function uI(e, t) {
	let r;
	for (r in t) {
		if (sy.call(t, r)) {
			switch (r) {
				case 'canContainEols': {
					let n = t[r];
					if (n) e[r].push(...n);
					break;
				}
				case 'transforms': {
					let n = t[r];
					if (n) e[r].push(...n);
					break;
				}
				case 'afterExit':
				case 'beforeEnter': {
					let n = t[r];
					if (n) e[r].push(n);
					break;
				}
				case 'enter':
				case 'exit': {
					let n = t[r];
					if (n) Object.assign(e[r], n);
					break;
				}
			}
		}
	}
}
function oy(e, t) {
	if (e) {
		throw Error(
			'Cannot close `' + e.type + '` (' + At({ start: e.start, end: e.end }) + '): a different token (`' + t.type
				+ '`, ' + At({ start: t.start, end: t.end }) + ') is open',
		);
	}
	throw Error(
		'Cannot close document, a token (`' + t.type + '`, ' + At({ start: t.start, end: t.end }) + ') is still open',
	);
}
function Ao(e) {
	let t = this;
	t.parser = r;
	function r(n) {
		return Ic(n, {
			...t.data('settings'),
			...e,
			extensions: t.data('micromarkExtensions') || [],
			mdastExtensions: t.data('fromMarkdownExtensions') || [],
		});
	}
}
var It = function(e) {
	if (e === null || e === void 0) return hI;
	if (typeof e === 'function') return Eo(e);
	if (typeof e === 'object') return Array.isArray(e) ? lI(e) : fI(e);
	if (typeof e === 'string') return pI(e);
	throw Error('Expected function, string, or object as test');
};
function lI(e) {
	let t = [], r = -1;
	while (++r < e.length) t[r] = It(e[r]);
	return Eo(n);
	function n(...i) {
		let o = -1;
		while (++o < t.length) if (t[o].apply(this, i)) return !0;
		return !1;
	}
}
function fI(e) {
	let t = e;
	return Eo(r);
	function r(n) {
		let i = n, o;
		for (o in e) if (i[o] !== t[o]) return !1;
		return !0;
	}
}
function pI(e) {
	return Eo(t);
	function t(r) {
		return r && r.type === e;
	}
}
function Eo(e) {
	return t;
	function t(r, n, i) {
		return Boolean(dI(r) && e.call(this, r, typeof n === 'number' ? n : void 0, i || void 0));
	}
}
function hI() {
	return !0;
}
function dI(e) {
	return e !== null && typeof e === 'object' && 'type' in e;
}
var En = It([
	'break',
	'delete',
	'emphasis',
	'footnote',
	'footnoteReference',
	'image',
	'imageReference',
	'inlineCode',
	'inlineMath',
	'link',
	'linkReference',
	'mdxJsxTextElement',
	'mdxTextExpression',
	'strong',
	'text',
	'textDirective',
]);
var cy = {}.hasOwnProperty;
function uy(e, t) {
	let r = t || {};
	function n(i, ...o) {
		let { invalid: s, handlers: a } = n;
		if (i && cy.call(i, e)) {
			let c = String(i[e]);
			s = cy.call(a, c) ? a[c] : n.unknown;
		}
		if (s) return s.call(this, i, ...o);
	}
	return n.handlers = r.handlers || {}, n.invalid = r.invalid, n.unknown = r.unknown, n;
}
var mI = {}.hasOwnProperty;
function Pc(e, t) {
	let r = -1, n;
	if (t.extensions) { while (++r < t.extensions.length) Pc(e, t.extensions[r]); }
	for (n in t) {
		if (mI.call(t, n)) {
			switch (n) {
				case 'extensions':
					break;
				case 'unsafe': {
					ly(e[n], t[n]);
					break;
				}
				case 'join': {
					ly(e[n], t[n]);
					break;
				}
				case 'handlers': {
					gI(e[n], t[n]);
					break;
				}
				default:
					e.options[n] = t[n];
			}
		}
	}
	return e;
}
function ly(e, t) {
	if (t) e.push(...t);
}
function gI(e, t) {
	if (t) Object.assign(e, t);
}
function fy(e, t, r, n) {
	let i = r.enter('blockquote'), o = r.createTracker(n);
	o.move('> '), o.shift(2);
	let s = r.indentLines(r.containerFlow(e, o.current()), yI);
	return i(), s;
}
function yI(e, t, r) {
	return '>' + (r ? '' : ' ') + e;
}
function Io(e, t) {
	return py(e, t.inConstruct, !0) && !py(e, t.notInConstruct, !1);
}
function py(e, t, r) {
	if (typeof t === 'string') t = [t];
	if (!t || t.length === 0) return r;
	let n = -1;
	while (++n < t.length) if (e.includes(t[n])) return !0;
	return !1;
}
function Oc(e, t, r, n) {
	let i = -1;
	while (++i < r.unsafe.length) {
		let o = r.unsafe[i];
		if (
			o.character === `
` && !o.before && !o.after && Io(r.stack, o)
		) return /[\t ]/.test(n.before) ? '' : ' ';
	}
	return '\\\n';
}
function hy(e, t) {
	let r = String(e), n = r.indexOf(t), i = n, o = 0, s = 0;
	if (typeof t !== 'string') throw TypeError('Expected substring');
	while (n !== -1) {
		if (n === i) { if (++o > s) s = o; }
		else o = 1;
		i = n + t.length, n = r.indexOf(t, i);
	}
	return s;
}
function In(e, t) {
	return Boolean(
		t.options.fences === !1 && e.value && !e.lang && /[^\n\r ]/.test(e.value)
			&& !/^[\t ]*(?:[\n\r]|$)|(?:^|[\n\r])[\t ]*$/.test(e.value),
	);
}
function dy(e) {
	let t = e.options.fence || '`';
	if (t !== '`' && t !== '~') {
		throw Error('Cannot serialize code with `' + t + '` for `options.fence`, expected `` ` `` or `~`');
	}
	return t;
}
function my(e, t, r, n) {
	let i = dy(r), o = e.value || '';
	if (In(e, r)) {
		let f = r.enter('codeIndented'), h = r.indentLines(o, bI);
		return f(), h;
	}
	let s = r.createTracker(n),
		a = i.repeat(Math.max(hy(o, i) + 1, 3)),
		c = r.enter('codeFenced'),
		u = i === '`' ? 'GraveAccent' : 'Tilde',
		l = s.move(a);
	if (e.lang) {
		let f = r.enter(`codeFencedLang${u}`);
		l += s.move(r.safe(e.lang, { before: l, after: ' ', encode: ['`'], ...s.current() })), f();
	}
	if (e.lang && e.meta) {
		let f = r.enter(`codeFencedMeta${u}`);
		l += s.move(' '),
			l += s.move(r.safe(e.meta, {
				before: l,
				after: `
`,
				encode: ['`'],
				...s.current(),
			})),
			f();
	}
	if (
		l += s.move(`
`),
			o
	) {
		l += s.move(
			o + `
`,
		);
	}
	return l += s.move(a), c(), l;
}
function bI(e, t, r) {
	return (r ? '' : '    ') + e;
}
function Tr(e) {
	let t = e.options.quote || '"';
	if (t !== '"' && t !== "'") {
		throw Error('Cannot serialize title with `' + t + '` for `options.quote`, expected `"`, or `\'`');
	}
	return t;
}
function gy(e, t, r, n) {
	let i = Tr(r),
		o = i === '"' ? 'Quote' : 'Apostrophe',
		s = r.enter('definition'),
		a = r.enter('label'),
		c = r.createTracker(n),
		u = c.move('[');
	if (
		u += c.move(r.safe(r.associationId(e), { before: u, after: ']', ...c.current() })),
			u += c.move(']: '),
			a(),
			!e.url || /[\0- \u007F]/.test(e.url)
	) {
		a = r.enter('destinationLiteral'),
			u += c.move('<'),
			u += c.move(r.safe(e.url, { before: u, after: '>', ...c.current() })),
			u += c.move('>');
	} else {a = r.enter('destinationRaw'),
			u += c.move(r.safe(e.url, {
				before: u,
				after: e.title ? ' ' : `
`,
				...c.current(),
			}));}
	if (a(), e.title) {
		a = r.enter(`title${o}`),
			u += c.move(' ' + i),
			u += c.move(r.safe(e.title, { before: u, after: i, ...c.current() })),
			u += c.move(i),
			a();
	}
	return s(), u;
}
function yy(e) {
	let t = e.options.emphasis || '*';
	if (t !== '*' && t !== '_') {
		throw Error('Cannot serialize emphasis with `' + t + '` for `options.emphasis`, expected `*`, or `_`');
	}
	return t;
}
Po.attention = xI;
Po.peek = kI;
function Po(e, t, r, n) {
	let i = r.enter('phrasing'), o = r.containerPhrasing({ type: 'root', children: [e] }, n);
	return i(), o;
}
function xI(e, t) {
	return { construct: 'emphasis', markers: yy(t) === '*' ? ['*', '_'] : ['_', '*'], sizes: [1] };
}
function kI(e, t, r) {
	return r.options.emphasis || '*';
}
function Ar(e) {
	return '&#x' + e.toString(16).toUpperCase() + ';';
}
function by(e) {
	return '\x1B[33m' + e + '\x1B[39m';
}
var xy = [], Oo = !0, Xt = !1, $o = 'skip';
function Pn(e, t, r, n) {
	let i;
	if (typeof t === 'function' && typeof r !== 'function') n = r, r = t;
	else i = t;
	let o = It(i), s = n ? -1 : 1;
	a(e, void 0, [])();
	function a(c, u, l) {
		let f = c && typeof c === 'object' ? c : {};
		if (typeof f.type === 'string') {
			let d = typeof f.tagName === 'string' ? f.tagName : typeof f.name === 'string' ? f.name : void 0;
			Object.defineProperty(h, 'name', { value: 'node (' + by(c.type + (d ? '<' + d + '>' : '')) + ')' });
		}
		return h;
		function h() {
			let d = xy, g, y, x;
			if (!t || o(c, u, l[l.length - 1] || void 0)) { if (d = wI(r(c, l)), d[0] === Xt) return d; }
			if ('children' in c && c.children) {
				let k = c;
				if (k.children && d[0] !== $o) {
					y = (n ? k.children.length : -1) + s, x = l.concat(k);
					while (y > -1 && y < k.children.length) {
						let z = k.children[y];
						if (g = a(z, y, x)(), g[0] === Xt) return g;
						y = typeof g[1] === 'number' ? g[1] : y + s;
					}
				}
			}
			return d;
		}
	}
}
function wI(e) {
	if (Array.isArray(e)) return e;
	if (typeof e === 'number') return [Oo, e];
	return e === null || e === void 0 ? xy : [e];
}
function $c(e, t, r, n) {
	let i, o, s;
	if (typeof t === 'function' && typeof r !== 'function') o = void 0, s = t, i = r;
	else o = t, s = r, i = n;
	Pn(e, o, a, i);
	function a(c, u) {
		let l = u[u.length - 1], f = l ? l.children.indexOf(c) : void 0;
		return s(c, f, l);
	}
}
function Lo(e, t) {
	let r = !1;
	return $c(e, function(n) {
		if ('value' in n && /\r?\n|\r/.test(n.value) || n.type === 'break') return r = !0, Xt;
	}),
		Boolean((!e.depth || e.depth < 3) && Ut(e) && (t.options.setext || r));
}
function ky(e, t, r, n) {
	let i = Math.max(Math.min(6, e.depth || 1), 1), o = r.createTracker(n);
	if (Lo(e, r)) {
		let f = r.enter('headingSetext'),
			h = r.enter('phrasing'),
			d = r.containerPhrasing(e, {
				...o.current(),
				before: `
`,
				after: `
`,
			});
		return h(),
			f(),
			d + `
` + (i === 1 ? '=' : '-').repeat(
				d.length - (Math.max(
					d.lastIndexOf('\r'),
					d.lastIndexOf(`
`),
				) + 1),
			);
	}
	let s = '#'.repeat(i), a = r.enter('headingAtx'), c = r.enter('phrasing');
	o.move(s + ' ');
	let u = r.containerPhrasing(e, {
			before: '# ',
			after: `
`,
			...o.current(),
		}),
		l = u.charCodeAt(0);
	if (l === 9 || l === 32) u = Ar(l) + u.slice(1);
	if (u = u ? s + ' ' + u : s, r.options.closeAtx) u += ' ' + s;
	return c(), a(), u;
}
Lc.peek = SI;
function Lc(e) {
	return e.value || '';
}
function SI() {
	return '<';
}
Nc.peek = vI;
function Nc(e, t, r, n) {
	let i = Tr(r),
		o = i === '"' ? 'Quote' : 'Apostrophe',
		s = r.enter('image'),
		a = r.enter('label'),
		c = r.createTracker(n),
		u = c.move('![');
	if (
		u += c.move(r.safe(e.alt, { before: u, after: ']', ...c.current() })),
			u += c.move(']('),
			a(),
			!e.url && e.title || /[\0- \u007F]/.test(e.url)
	) {
		a = r.enter('destinationLiteral'),
			u += c.move('<'),
			u += c.move(r.safe(e.url, { before: u, after: '>', ...c.current() })),
			u += c.move('>');
	} else {a = r.enter('destinationRaw'),
			u += c.move(r.safe(e.url, { before: u, after: e.title ? ' ' : ')', ...c.current() }));}
	if (a(), e.title) {
		a = r.enter(`title${o}`),
			u += c.move(' ' + i),
			u += c.move(r.safe(e.title, { before: u, after: i, ...c.current() })),
			u += c.move(i),
			a();
	}
	return u += c.move(')'), s(), u;
}
function vI() {
	return '!';
}
qc.peek = _I;
function qc(e, t, r, n) {
	let i = e.referenceType,
		o = r.enter('imageReference'),
		s = r.enter('label'),
		a = r.createTracker(n),
		c = a.move('!['),
		u = r.safe(e.alt, { before: c, after: ']', ...a.current() });
	c += a.move(u + ']['), s();
	let l = r.stack;
	r.stack = l.filter(function(h) {
		return h !== 'phrasing';
	}), s = r.enter('reference');
	let f = r.safe(r.associationId(e), { before: c, after: ']', ...a.current() });
	if (s(), r.stack = l, o(), i === 'full' || !u || u !== f) c += a.move(f + ']');
	else if (i === 'shortcut') c = c.slice(0, -1);
	else c += a.move(']');
	return c;
}
function _I() {
	return '!';
}
Dc.peek = CI;
function Dc(e, t, r) {
	let n = e.value || '', i = '`', o = -1;
	while (new RegExp('(^|[^`])' + i + '([^`]|$)').test(n)) i += '`';
	if (/[^\n\r ]/.test(n) && (/^[\n\r ]/.test(n) && /[\n\r ]$/.test(n) || /^`|`$/.test(n))) n = ' ' + n + ' ';
	while (++o < r.unsafe.length) {
		let s = r.unsafe[o], a = r.compilePattern(s);
		if (!s.atBreak) continue;
		let c;
		while (c = a.exec(n)) {
			let u = c.index;
			if (n.charCodeAt(u) === 10 && n.charCodeAt(u - 1) === 13) u--;
			n = n.slice(0, u) + ' ' + n.slice(c.index + 1);
		}
	}
	return i + n + i;
}
function CI() {
	return '`';
}
function Mc(e, t) {
	let r = Ut(e);
	return Boolean(
		!t.options.resourceLink && e.url && !e.title && e.children && e.children.length === 1
			&& e.children[0].type === 'text' && (r === e.url || 'mailto:' + r === e.url) && /^[a-z][+\-.a-z]+:/i.test(e.url)
			&& !/[\0- <>\u007F]/.test(e.url),
	);
}
Fc.peek = zI;
function Fc(e, t, r, n) {
	let i = Tr(r), o = i === '"' ? 'Quote' : 'Apostrophe', s = r.createTracker(n);
	if (Mc(e, r)) {
		let l = r.stack;
		r.stack = l.filter(function(d) {
			return d !== 'phrasing';
		});
		let f = r.enter('autolink'), h = s.move('<');
		return h += s.move(r.containerPhrasing(e, { before: h, after: '>', ...s.current() })),
			h += s.move('>'),
			f(),
			r.stack = l,
			h;
	}
	let a = r.enter('link'), c = r.enter('label'), u = s.move('[');
	if (
		u += s.move(r.containerPhrasing(e, { before: u, after: '](', ...s.current() })),
			u += s.move(']('),
			c(),
			!e.url && e.title || /[\0- \u007F]/.test(e.url)
	) {
		c = r.enter('destinationLiteral'),
			u += s.move('<'),
			u += s.move(r.safe(e.url, { before: u, after: '>', ...s.current() })),
			u += s.move('>');
	} else {c = r.enter('destinationRaw'),
			u += s.move(r.safe(e.url, { before: u, after: e.title ? ' ' : ')', ...s.current() }));}
	if (c(), e.title) {
		c = r.enter(`title${o}`),
			u += s.move(' ' + i),
			u += s.move(r.safe(e.title, { before: u, after: i, ...s.current() })),
			u += s.move(i),
			c();
	}
	return u += s.move(')'), a(), u;
}
function zI(e, t, r) {
	return Mc(e, r) ? '<' : '[';
}
Rc.peek = TI;
function Rc(e, t, r, n) {
	let i = e.referenceType,
		o = r.enter('linkReference'),
		s = r.enter('label'),
		a = r.createTracker(n),
		c = a.move('['),
		u = r.containerPhrasing(e, { before: c, after: ']', ...a.current() });
	c += a.move(u + ']['), s();
	let l = r.stack;
	r.stack = l.filter(function(h) {
		return h !== 'phrasing';
	}), s = r.enter('reference');
	let f = r.safe(r.associationId(e), { before: c, after: ']', ...a.current() });
	if (s(), r.stack = l, o(), i === 'full' || !u || u !== f) c += a.move(f + ']');
	else if (i === 'shortcut') c = c.slice(0, -1);
	else c += a.move(']');
	return c;
}
function TI() {
	return '[';
}
function Er(e) {
	let t = e.options.bullet || '*';
	if (t !== '*' && t !== '+' && t !== '-') {
		throw Error('Cannot serialize items with `' + t + '` for `options.bullet`, expected `*`, `+`, or `-`');
	}
	return t;
}
function wy(e) {
	let t = Er(e), r = e.options.bulletOther;
	if (!r) return t === '*' ? '-' : '*';
	if (r !== '*' && r !== '+' && r !== '-') {
		throw Error('Cannot serialize items with `' + r + '` for `options.bulletOther`, expected `*`, `+`, or `-`');
	}
	if (r === t) throw Error('Expected `bullet` (`' + t + '`) and `bulletOther` (`' + r + '`) to be different');
	return r;
}
function Sy(e) {
	let t = e.options.bulletOrdered || '.';
	if (t !== '.' && t !== ')') {
		throw Error('Cannot serialize items with `' + t + '` for `options.bulletOrdered`, expected `.` or `)`');
	}
	return t;
}
function No(e) {
	let t = e.options.rule || '*';
	if (t !== '*' && t !== '-' && t !== '_') {
		throw Error('Cannot serialize rules with `' + t + '` for `options.rule`, expected `*`, `-`, or `_`');
	}
	return t;
}
function vy(e, t, r, n) {
	let i = r.enter('list'),
		o = r.bulletCurrent,
		s = e.ordered ? Sy(r) : Er(r),
		a = e.ordered ? s === '.' ? ')' : '.' : wy(r),
		c = t && r.bulletLastUsed ? s === r.bulletLastUsed : !1;
	if (!e.ordered) {
		let l = e.children ? e.children[0] : void 0;
		if (
			(s === '*' || s === '-') && l && (!l.children || !l.children[0]) && r.stack[r.stack.length - 1] === 'list'
			&& r.stack[r.stack.length - 2] === 'listItem' && r.stack[r.stack.length - 3] === 'list'
			&& r.stack[r.stack.length - 4] === 'listItem' && r.indexStack[r.indexStack.length - 1] === 0
			&& r.indexStack[r.indexStack.length - 2] === 0 && r.indexStack[r.indexStack.length - 3] === 0
		) c = !0;
		if (No(r) === s && l) {
			let f = -1;
			while (++f < e.children.length) {
				let h = e.children[f];
				if (h && h.type === 'listItem' && h.children && h.children[0] && h.children[0].type === 'thematicBreak') {
					c = !0;
					break;
				}
			}
		}
	}
	if (c) s = a;
	r.bulletCurrent = s;
	let u = r.containerFlow(e, n);
	return r.bulletLastUsed = s, r.bulletCurrent = o, i(), u;
}
function _y(e) {
	let t = e.options.listItemIndent || 'one';
	if (t !== 'tab' && t !== 'one' && t !== 'mixed') {
		throw Error(
			'Cannot serialize items with `' + t + '` for `options.listItemIndent`, expected `tab`, `one`, or `mixed`',
		);
	}
	return t;
}
function Cy(e, t, r, n) {
	let i = _y(r), o = r.bulletCurrent || Er(r);
	if (t && t.type === 'list' && t.ordered) {
		o = (typeof t.start === 'number' && t.start > -1 ? t.start : 1)
			+ (r.options.incrementListMarker === !1 ? 0 : t.children.indexOf(e)) + o;
	}
	let s = o.length + 1;
	if (i === 'tab' || i === 'mixed' && (t && t.type === 'list' && t.spread || e.spread)) s = Math.ceil(s / 4) * 4;
	let a = r.createTracker(n);
	a.move(o + ' '.repeat(s - o.length)), a.shift(s);
	let c = r.enter('listItem'), u = r.indentLines(r.containerFlow(e, a.current()), l);
	return c(), u;
	function l(f, h, d) {
		if (h) return (d ? '' : ' '.repeat(s)) + f;
		return (d ? o : o + ' '.repeat(s - o.length)) + f;
	}
}
function zy(e, t, r, n) {
	let i = r.enter('paragraph'), o = r.enter('phrasing'), s = r.containerPhrasing(e, n);
	return o(), i(), s;
}
function Ty(e, t, r, n) {
	if (
		!e.children.some(function(a) {
			return En(a);
		})
	) return r.containerFlow(e, n);
	let o = r.enter('phrasing'), s = r.containerPhrasing(e, n);
	return o(), s;
}
function Ay(e) {
	let t = e.options.strong || '*';
	if (t !== '*' && t !== '_') {
		throw Error('Cannot serialize strong with `' + t + '` for `options.strong`, expected `*`, or `_`');
	}
	return t;
}
qo.attention = AI;
qo.peek = EI;
function qo(e, t, r, n) {
	let i = r.enter('phrasing'), o = r.containerPhrasing({ type: 'root', children: [e] }, n);
	return i(), o;
}
function AI(e, t) {
	return { construct: 'strong', markers: Ay(t) === '*' ? ['*', '_'] : ['_', '*'], sizes: [2] };
}
function EI(e, t, r) {
	return r.options.strong || '*';
}
function Ey(e, t, r, n) {
	let i = t ? t.children : [], o = i.indexOf(e);
	return r.safe(e.value, { ...n, afterNode: i[o + 1], beforeNode: i[o - 1] });
}
function Iy(e) {
	let t = e.options.ruleRepetition || 3;
	if (t < 3) {
		throw Error(
			'Cannot serialize rules with repetition `' + t + '` for `options.ruleRepetition`, expected `3` or more',
		);
	}
	return t;
}
function Py(e, t, r) {
	let n = (No(r) + (r.options.ruleSpaces ? ' ' : '')).repeat(Iy(r));
	return r.options.ruleSpaces ? n.slice(0, -1) : n;
}
var er = {
	blockquote: fy,
	break: Oc,
	code: my,
	definition: gy,
	emphasis: Po,
	hardBreak: Oc,
	heading: ky,
	html: Lc,
	image: Nc,
	imageReference: qc,
	inlineCode: Dc,
	link: Fc,
	linkReference: Rc,
	list: vy,
	listItem: Cy,
	paragraph: zy,
	root: Ty,
	strong: qo,
	text: Ey,
	thematicBreak: Py,
};
function On(e) {
	if (e.charCodeAt(0) !== 60) return;
	let t = e.charCodeAt(1);
	if (t === 33) {
		let a = e.charCodeAt(2);
		if (a === 45) return 2;
		if (a === 91) return 5;
		if (oe(a)) return 4;
		return;
	}
	if (t === 63) return 3;
	let r = t === 47, n = r ? 2 : 1, i = n, o = e.charCodeAt(i);
	if (!oe(o)) return;
	while (o === 45 || ae(o)) o = e.charCodeAt(++i);
	let s = e.slice(n, i).toLowerCase();
	if (!r && o !== 47 && zn.includes(s)) return 1;
	return wo.includes(s) ? 6 : 7;
}
var Oy = [II];
function II(e, t, r, n) {
	if (t.type === 'code' && In(t, n) && (e.type === 'list' || e.type === t.type && In(e, n))) return !1;
	if ('spread' in r && typeof r.spread === 'boolean') {
		if (e.type === 'paragraph' && (e.type === t.type || t.type === 'definition' || t.type === 'heading' && Lo(t, n))) {
			return;
		}
		if (e.type === 'html') {
			let i = On(e.value);
			if (i === void 0 || i === 6 || i === 7) return 1;
		}
		if (e.type === 'paragraph' && t.type === 'html') {
			let i = On(t.value);
			if (i === void 0 || i === 7) return 1;
		}
		return r.spread ? 1 : 0;
	}
}
var tr = ['autolink', 'destinationLiteral', 'destinationRaw', 'reference', 'titleQuote', 'titleApostrophe'],
	Bc = [
		{ character: '\t', after: '[\\r\\n]', inConstruct: 'phrasing' },
		{ character: '\t', before: '[\\r\\n]', inConstruct: 'phrasing' },
		{ character: '\t', inConstruct: ['codeFencedLangGraveAccent', 'codeFencedLangTilde'] },
		{
			character: '\r',
			inConstruct: [
				'codeFencedLangGraveAccent',
				'codeFencedLangTilde',
				'codeFencedMetaGraveAccent',
				'codeFencedMetaTilde',
				'destinationLiteral',
				'headingAtx',
			],
		},
		{
			character: `
`,
			inConstruct: [
				'codeFencedLangGraveAccent',
				'codeFencedLangTilde',
				'codeFencedMetaGraveAccent',
				'codeFencedMetaTilde',
				'destinationLiteral',
				'headingAtx',
			],
		},
		{ character: '\r', before: '[\\r\\n]', inConstruct: 'phrasing' },
		{ character: '\r', after: '\\r', inConstruct: 'phrasing' },
		{
			character: `
`,
			before: '\\n',
			inConstruct: 'phrasing',
		},
		{
			character: `
`,
			after: '[\\r\\n]',
			inConstruct: 'phrasing',
		},
		{ character: ' ', after: '[\\r\\n]', inConstruct: 'phrasing' },
		{ character: ' ', before: '[\\r\\n]', inConstruct: 'phrasing' },
		{ character: ' ', inConstruct: ['codeFencedLangGraveAccent', 'codeFencedLangTilde'] },
		{ character: '!', after: '\\[', inConstruct: 'phrasing', notInConstruct: tr },
		{ character: '"', inConstruct: 'titleQuote' },
		{ atBreak: !0, character: '#' },
		{
			character: '#',
			inConstruct: 'headingAtx',
			after: `(?:[\r
]|$)`,
		},
		{ character: '&', after: '[#A-Za-z]', inConstruct: 'phrasing' },
		{ character: "'", inConstruct: 'titleApostrophe' },
		{ character: '(', inConstruct: 'destinationRaw' },
		{ before: '\\]', character: '(', inConstruct: 'phrasing', notInConstruct: tr },
		{ atBreak: !0, before: '\\d+', character: ')' },
		{ character: ')', inConstruct: 'destinationRaw' },
		{
			atBreak: !0,
			character: '*',
			after: `(?:[ 	\r
*])`,
		},
		{ character: '*', inConstruct: 'phrasing', notInConstruct: tr },
		{
			atBreak: !0,
			character: '+',
			after: `(?:[ 	\r
])`,
		},
		{
			atBreak: !0,
			character: '-',
			after: `(?:[ 	\r
-])`,
		},
		{
			atBreak: !0,
			before: '\\d+',
			character: '.',
			after: `(?:[ 	\r
]|$)`,
		},
		{ atBreak: !0, character: '<', after: '[!/?A-Za-z]' },
		{ character: '<', after: '[!/?A-Za-z]', inConstruct: 'phrasing', notInConstruct: tr },
		{ character: '<', inConstruct: 'destinationLiteral' },
		{ atBreak: !0, character: '=' },
		{ atBreak: !0, character: '>' },
		{ character: '>', inConstruct: 'destinationLiteral' },
		{ atBreak: !0, character: '[' },
		{ character: '[', inConstruct: 'phrasing', notInConstruct: tr },
		{ character: '[', inConstruct: ['label', 'reference'] },
		{ character: '\\', after: '[\\r\\n]', inConstruct: 'phrasing' },
		{ character: ']', inConstruct: ['label', 'reference'] },
		{ atBreak: !0, character: '_' },
		{ character: '_', inConstruct: 'phrasing', notInConstruct: tr },
		{ atBreak: !0, character: '`' },
		{ character: '`', inConstruct: ['codeFencedLangGraveAccent', 'codeFencedMetaGraveAccent'] },
		{ character: '`', inConstruct: 'phrasing', notInConstruct: tr },
		{ atBreak: !0, character: '~' },
		{ character: '<', inConstruct: 'autolink' },
		{ character: '>', inConstruct: 'autolink' },
		{ character: '', inConstruct: 'autolink' },
	],
	$y = -1;
while (++$y < 33) Bc.push({ character: String.fromCharCode($y), inConstruct: 'autolink' });
function Ly(e) {
	if (e.label || !e.identifier) return e.label || '';
	return To(e.identifier);
}
function Ny(e) {
	if (!e._compiled) {
		let t = (e.atBreak ? '[\\r\\n][\\t ]*' : '') + (e.before ? '(?:' + e.before + ')' : '');
		e._compiled = new RegExp(
			(e.beforeNode ? '^' : t ? '(' + t + ')' : '') + (/[$()*+.?[\\\]^{|}]/.test(e.character) ? '\\' : '') + e.character
				+ (e.afterNode ? '$' : e.after ? '(?:' + e.after + ')' : ''),
			e.unicode ? 'gu' : 'g',
		);
	}
	return e._compiled;
}
function $n(e) {
	let t = e.codePointAt(0);
	return t === void 0 ? '' : String.fromCodePoint(t);
}
function Ir(e) {
	let t = e.codePointAt(e.length - 2);
	return t !== void 0 && t > 65535 ? e.slice(-2) : e.slice(-1);
}
function Zc(e, t, r) {
	let n = Se(e), i = Se(t);
	if (n === void 0) {
		return i === void 0
			? r === '_' ? { inside: !0, outside: !0 } : { inside: !1, outside: !1 }
			: i === 1
			? { inside: !0, outside: !0 }
			: { inside: !1, outside: !0 };
	}
	if (n === 1) {
		return i === void 0
			? { inside: !1, outside: !1 }
			: i === 1
			? { inside: !0, outside: !0 }
			: { inside: !1, outside: !1 };
	}
	return i === void 0
		? { inside: !1, outside: !1 }
		: i === 1
		? { inside: !0, outside: !1 }
		: { inside: !1, outside: !1 };
}
var PI = new Map([['*', !1], ['_', !0]]);
function OI(e, t, r) {
	let n = new Set();
	for (let o of e) {
		let s = r.get(o);
		if (s && o.attention && t.some((a) => a.attention === o.attention)) { for (let a of s.tokens) n.add(a.attention); }
	}
	let i = [];
	for (let o of e) if (o.attention && n.delete(o.attention)) i.push(o.attention);
	return i.reverse(), i;
}
function qy(e, t, r) {
	let n = [], i = new Map(), o = new Map(), s = 0;
	while (s < e.length) {
		if (!e[s].attention) {
			s++;
			continue;
		}
		let a = e[s].value.charAt(0), c = PI.get(a), u = s + 1;
		while (u < e.length && e[u].attention && e[u].value.charAt(0) === a) u++;
		let l = s ? e[s - 1].value : t,
			f = Se(l.charCodeAt(l.length - 1)),
			h = Se((u < e.length ? e[u].value : r).charCodeAt(0)),
			d = !h || h === 2 && Boolean(f),
			g = !f || f === 2 && Boolean(h),
			y = {
				tokens: e.slice(s, u),
				markers: [],
				start: 0,
				end: 0,
				open: c ? d && (Boolean(f) || !g) : d,
				close: c ? g && (Boolean(h) || !d) : g,
				split: c !== void 0,
			};
		for (let x of y.tokens) {
			i.set(x, [...y.tokens]), o.set(x, y);
			let k = x.value.length;
			while (k--) y.markers.push(x);
		}
		y.end = y.markers.length, n.push(y), s = u;
	}
	LI(n, i), s = -1;
	while (++s < e.length) {
		let a = i.get(e[s]);
		if (a) return { attention: OI(e, a, o), index: s };
	}
}
function Dy(e, t, r) {
	return jc(My(e, t, r), r.before, r.after);
}
function Do(e, t) {
	let r = e[t ? 0 : e.length - 1];
	if (!r || r.attention) return;
	let n = t ? $n(r.value) : Ir(r.value), i = Ar(n.codePointAt(0));
	r.value = t ? i + r.value.slice(n.length) : r.value.slice(0, r.value.length - n.length) + i;
}
function $I(e, t, r, n, i) {
	for (let o of r.attention) {
		let s = t.get(o) || o.sequences[0];
		for (let a of o.sequences) {
			if (a === s) continue;
			let c = new Map(t);
			c.set(o, a);
			let u = Uc(e, c, n, i), l = qy(u, n, i);
			if (!l || l.index > r.index) return { chosen: c, mistake: l, tokens: u };
		}
	}
}
function LI(e, t) {
	let r = 0;
	while (r < e.length) {
		let n = e[r], i = n.tokens[0].value.charAt(0), o = n.end - n.start, s = n.close && o ? r : 0;
		while (s--) {
			let a = e[s], c = a.end - a.start;
			if (
				a.tokens[0].value.charAt(0) === i && a.open && c
				&& (n.split ? !((a.close || n.open) && o % 3) || (c + o) % 3 : c === a.markers.length && c === o)
			) {
				let u = n.split ? c > 1 && o > 1 ? 2 : 1 : o,
					l = a.markers.slice(a.end - u, a.end),
					f = n.markers.slice(n.start, n.start + u),
					h = l[0],
					d = f[0];
				if (
					h === l[u - 1] && h.value.length === u && d === f[u - 1] && d.value.length === u
					&& h.attention === d.attention
				) t.delete(h), t.delete(d);
				else {
					let g = [...new Set([...l, ...f])];
					for (let y of g) {
						let x = t.get(y);
						if (x) x.push(...g);
					}
				}
				a.end -= u, n.start += u;
				break;
			}
		}
		if (s === -1 || n.start === n.end) r++;
	}
}
function NI(e, t, r) {
	if (t.length === 0) {
		throw Error('Cannot serialize `' + e + '` as attention without markers, expected one or more markers');
	}
	if (r.length === 0) {
		throw Error('Cannot serialize `' + e + '` as attention without sizes, expected one or more sizes');
	}
	for (let i of r) {
		if (!Number.isSafeInteger(i) || i < 1) {
			throw Error('Cannot serialize `' + e + '` as attention with `' + i + '` as size, expected positive integer');
		}
	}
	let n = [];
	for (let i of t) {
		if (i.length !== 1) {
			throw Error(
				'Cannot serialize `' + e + '` as attention with `' + i + '` as marker, expected a single ascii character',
			);
		}
		if (!fo(i.charCodeAt(0))) {
			throw Error('Cannot serialize `' + e + '` as attention with `' + i + '` as marker, expected ascii punctuation');
		}
		for (let o of r) n.push(i.repeat(o));
	}
	return n;
}
function My(e, t, r) {
	let n = t.indexStack, i = e.children || [], o = [], s = -1, a = r.before;
	n.push(-1);
	let c = t.createTracker(r);
	while (++s < i.length) {
		let u = i[s], l;
		if (n[n.length - 1] = s, s + 1 < i.length) {
			let d = t.handle.handlers[i[s + 1].type];
			if (d && d.peek) d = d.peek;
			l = d ? $n(d(i[s + 1], e, t, { before: '', after: '', ...c.current() })) : '';
		} else l = r.after;
		let f = o[o.length - 1];
		if (
			typeof f === 'string' && (a === '\r' || a === `
`)
			&& u.type === 'html' && On(u.value) !== 7
		) {
			o[o.length - 1] = f.replace(/(\r?\n|\r)$/, ' '),
				a = ' ',
				c = t.createTracker(r),
				c.move(jc(o, r.before, r.after));
		}
		let h = t.handle.handlers[u.type];
		if (h && h.attention) {
			let { construct: d, markers: g, sizes: y } = h.attention(u, t), x = NI(u.type, g, y), k = x[0], z = t.enter(d);
			c.move(k);
			let _ = My(u, t, { ...c.current(), before: k, after: k });
			c.move(jc(_, k, k)), c.move(k), z(), o.push({ children: _, sequences: x }), a = k.charAt(k.length - 1);
		} else {
			let d = t.handle(u, e, t, { ...c.current(), after: l, before: a });
			if (!d) continue;
			c.move(d), o.push(d), a = Ir(d);
		}
	}
	return n.pop(), o;
}
function Uc(e, t, r, n) {
	let i = [], o, s = Ir(r), a = -1;
	while (++a < e.length) {
		let c = e[a];
		if (typeof c === 'string') {
			let _ = { value: c, attention: void 0 };
			if (o && o === $n(c)) Do([_], !0);
			if (o = void 0, i.push(_), _.value) s = Ir(_.value);
			continue;
		}
		let u = t.get(c) || c.sequences[0],
			l = u.charAt(0),
			f = e[a + 1],
			h = s,
			d = $n(f === void 0 ? n : typeof f === 'string' ? f : t.get(f) || f.sequences[0]),
			g = Uc(c.children, t, u, u),
			y = g.length > 0 ? g[0].value : '',
			x = Zc(h.charCodeAt(h.length - 1), y.charCodeAt(0), l);
		if (x.inside) Do(g, !0);
		let k = g.length > 0 ? Ir(g[g.length - 1].value) : '', z = Zc(d.charCodeAt(0), k.charCodeAt(k.length - 1), l);
		if (z.inside) Do(g, !1);
		if (
			x.outside && h !== `
`
			&& h !== '\r'
		) Do(i, !1);
		if (z.outside) o = d;
		i.push({ value: u, attention: c }, ...g, { value: u, attention: c }), s = u.charAt(u.length - 1);
	}
	return i;
}
function jc(e, t, r) {
	let n = new Map(), i = Uc(e, n, t, r), o = i, s = qy(o, t, r);
	while (s) {
		let c = $I(e, n, s, t, r);
		if (!c) {
			o = i;
			break;
		}
		n = c.chosen, o = c.tokens, s = c.mistake;
	}
	let a = '';
	for (let c of o) a += c.value;
	return a;
}
function Fy(e, t, r) {
	let n = t.indexStack, i = e.children || [], o = t.createTracker(r), s = [], a = -1;
	n.push(-1);
	while (++a < i.length) {
		let c = i[a];
		if (
			n[n.length - 1] = a,
				s.push(o.move(t.handle(c, e, t, {
					before: `
`,
					after: `
`,
					...o.current(),
				}))),
				c.type !== 'list'
		) t.bulletLastUsed = void 0;
		if (a < i.length - 1) s.push(o.move(qI(c, i[a + 1], e, t)));
	}
	return n.pop(), s.join('');
}
function qI(e, t, r, n) {
	let i = n.join.length;
	while (i--) {
		let o = n.join[i](e, t, r, n);
		if (o === !0 || o === 1) break;
		if (typeof o === 'number') {
			return `
`.repeat(1 + o);
		}
		if (o === !1) {
			return `

<!---->

`;
		}
	}
	return `

`;
}
var DI = /\r?\n|\r/g;
function Ry(e, t) {
	let r = [], n = 0, i = 0, o;
	while (o = DI.exec(e)) s(e.slice(n, o.index)), r.push(o[0]), n = o.index + o[0].length, i++;
	return s(e.slice(n)), r.join('');
	function s(a) {
		r.push(t(a, i, !a));
	}
}
var Vc = {}.hasOwnProperty;
function jy(e, t, r) {
	let n = (r.before || '') + (t || '') + (r.after || ''),
		i = [],
		o = [],
		s = {},
		a = e.stack.includes('autolink'),
		c = r.before ? r.before.length : 0,
		u = n.length - (r.after ? r.after.length : 0),
		l = -1;
	while (++l < e.unsafe.length) {
		let d = e.unsafe[l];
		if (!Io(e.stack, d) || !By(d.beforeNode, r.beforeNode) || !By(d.afterNode, r.afterNode)) continue;
		let g = e.compilePattern(d), y = d.beforeNode ? c : 0, x = n.slice(y, d.afterNode ? u : void 0), k;
		while (k = g.exec(x)) {
			let z = 'before' in d || Boolean(d.atBreak), _ = 'after' in d, O = y + k.index + (z ? k[1].length : 0);
			if (Vc.call(s, O)) {
				if (s[O].before && !z) s[O].before = !1;
				if (s[O].after && !_) s[O].after = !1;
			} else i.push(O), s[O] = { before: z, after: _ };
		}
	}
	i.sort(MI);
	let f = c;
	l = -1;
	while (++l < i.length) {
		let d = i[l];
		if (d < f || d >= u) continue;
		if (
			n.charAt(d) === '_' && d > 0 && Se(n.charCodeAt(d - 1)) === void 0 && !Vc.call(s, d - 1)
			&& !(d - 1 === c && /[*_]/.test(n.charAt(c - 1)))
		) {
			let g = d + 1;
			while (g < u && n.charAt(g) === '_') g++;
			let y = g - d - 1;
			if (
				i[l + y] === g - 1 && g < n.length && Se(n.charCodeAt(g)) === void 0 && !Vc.call(s, g)
				&& !(g === u - 1 && /[*_]/.test(n.charAt(u)))
			) {
				l += y;
				continue;
			}
		}
		if (
			d + 1 < u && i[l + 1] === d + 1 && s[d].after && !s[d + 1].before && !s[d + 1].after
			|| i[l - 1] === d - 1 && s[d].before && !s[d - 1].before && !s[d - 1].after
		) continue;
		if (f !== d) {
			let g = n.slice(f, d);
			o.push(a ? g : Zy(g, '\\'));
		}
		if (f = d, a) o.push('%' + n.charCodeAt(d).toString(16).toUpperCase().padStart(2, '0')), f++;
		else if (/[!-/:-@[-`{-~]/.test(n.charAt(d)) && (!r.encode || !r.encode.includes(n.charAt(d)))) o.push('\\');
		else o.push(Ar(n.charCodeAt(d))), f++;
	}
	let h = n.slice(f, u);
	return o.push(a ? h : Zy(h, r.after)), o.join('');
}
function By(e, t) {
	if (!e) return !0;
	if (!t) return !1;
	return typeof e === 'string' ? e === t.type : e.includes(t.type);
}
function MI(e, t) {
	return e - t;
}
function Zy(e, t) {
	let r = /\\(?=[!-/:-@[-`{-~])/g, n = [], i = [], o = e + t, s = -1, a = 0, c;
	while (c = r.exec(o)) n.push(c.index);
	while (++s < n.length) {
		if (a !== n[s]) i.push(e.slice(a, n[s]));
		i.push('\\'), a = n[s];
	}
	return i.push(e.slice(a)), i.join('');
}
function Uy(e) {
	let t = e || {}, r = t.now || {}, n = t.lineShift || 0, i = r.line || 1, o = r.column || 1;
	return { move: c, current: s, shift: a };
	function s() {
		return { now: { line: i, column: o }, lineShift: n };
	}
	function a(u) {
		n += u;
	}
	function c(u) {
		let l = u || '', f = l.split(/\r?\n|\r/g), h = f[f.length - 1];
		return i += f.length - 1, o = f.length === 1 ? o + h.length : 1 + h.length + n, l;
	}
}
function Kc(e, t) {
	let r = t || {},
		n = {
			associationId: Ly,
			bulletCurrent: void 0,
			bulletLastUsed: void 0,
			containerPhrasing: ZI,
			containerFlow: jI,
			createTracker: Uy,
			compilePattern: Ny,
			enter: o,
			handlers: { ...er },
			handle: void 0,
			indentLines: Ry,
			indexStack: [],
			join: [...Oy],
			options: {},
			safe: UI,
			stack: [],
			unsafe: [...Bc],
		};
	if (Pc(n, r), n.options.tightDefinitions) n.join.push(BI);
	n.handle = uy('type', { invalid: FI, unknown: RI, handlers: n.handlers });
	let i = n.handle(En(e) ? { type: 'root', children: [e] } : e, void 0, n, {
		before: `
`,
		after: `
`,
		now: { line: 1, column: 1 },
		lineShift: 0,
	});
	if (i && i.charCodeAt(i.length - 1) !== 10 && i.charCodeAt(i.length - 1) !== 13) {
		i += `
`;
	}
	return i;
	function o(s) {
		return n.stack.push(s), a;
		function a() {
			n.stack.pop();
		}
	}
}
function FI(e) {
	throw Error('Cannot handle value `' + e + '`, expected node');
}
function RI(e) {
	throw Error('Cannot handle unknown node `' + e.type + '`');
}
function BI(e, t) {
	if (e.type === 'definition' && e.type === t.type) return 0;
}
function ZI(e, t) {
	return Dy(e, this, t);
}
function jI(e, t) {
	return Fy(e, this, t);
}
function UI(e, t) {
	return jy(this, e, t);
}
function Mo(e) {
	let t = this;
	t.compiler = r;
	function r(n) {
		return Kc(n, { ...t.data('settings'), ...e, extensions: t.data('toMarkdownExtensions') || [] });
	}
}
function Jc(e) {
	if (e) throw e;
}
var jo = Xu(Xy(), 1);
function Ln(e) {
	if (typeof e !== 'object' || e === null) return !1;
	let t = Object.getPrototypeOf(e);
	return (t === null || t === Object.prototype || Object.getPrototypeOf(t) === null) && !(Symbol.toStringTag in e)
		&& !(Symbol.iterator in e);
}
function Hc() {
	let e = [], t = { run: r, use: n };
	return t;
	function r(...i) {
		let o = -1, s = i.pop();
		if (typeof s !== 'function') throw TypeError('Expected function as last argument, not ' + s);
		a(null, ...i);
		function a(c, ...u) {
			let l = e[++o], f = -1;
			if (c) {
				s(c);
				return;
			}
			while (++f < i.length) if (u[f] === null || u[f] === void 0) u[f] = i[f];
			if (i = u, l) eb(l, a)(...u);
			else s(null, ...u);
		}
	}
	function n(i) {
		if (typeof i !== 'function') throw TypeError('Expected `middelware` to be a function, not ' + i);
		return e.push(i), t;
	}
}
function eb(e, t) {
	let r;
	return n;
	function n(...s) {
		let a = e.length > s.length, c;
		if (a) s.push(i);
		try {
			c = e.apply(this, s);
		} catch (u) {
			let l = u;
			if (a && r) throw l;
			return i(l);
		}
		if (!a) {
			if (c && c.then && typeof c.then === 'function') c.then(o, i);
			else if (c instanceof Error) i(c);
			else o(c);
		}
	}
	function i(s, ...a) {
		if (!r) r = !0, t(s, ...a);
	}
	function o(s) {
		i(null, s);
	}
}
class me extends Error {
	constructor(e, t, r) {
		super();
		if (typeof t === 'string') r = t, t = void 0;
		let n = '', i = {}, o = !1;
		if (t) {
			if ('line' in t && 'column' in t) i = { place: t };
			else if ('start' in t && 'end' in t) i = { place: t };
			else if ('type' in t) i = { ancestors: [t], place: t.position };
			else i = { ...t };
		}
		if (typeof e === 'string') n = e;
		else if (!i.cause && e) o = !0, n = e.message, i.cause = e;
		if (!i.ruleId && !i.source && typeof r === 'string') {
			let a = r.indexOf(':');
			if (a === -1) i.ruleId = r;
			else i.source = r.slice(0, a), i.ruleId = r.slice(a + 1);
		}
		if (!i.place && i.ancestors && i.ancestors) {
			let a = i.ancestors[i.ancestors.length - 1];
			if (a) i.place = a.position;
		}
		let s = i.place && 'start' in i.place ? i.place.start : i.place;
		this.ancestors = i.ancestors || void 0,
			this.cause = i.cause || void 0,
			this.column = s ? s.column : void 0,
			this.fatal = void 0,
			this.file = '',
			this.message = n,
			this.line = s ? s.line : void 0,
			this.name = At(i.place) || '1:1',
			this.place = i.place || void 0,
			this.reason = this.message,
			this.ruleId = i.ruleId || void 0,
			this.source = i.source || void 0,
			this.stack = o && i.cause && typeof i.cause.stack === 'string' ? i.cause.stack : '',
			this.actual = void 0,
			this.expected = void 0,
			this.note = void 0,
			this.url = void 0;
	}
}
me.prototype.file = '';
me.prototype.name = '';
me.prototype.reason = '';
me.prototype.message = '';
me.prototype.stack = '';
me.prototype.column = void 0;
me.prototype.line = void 0;
me.prototype.ancestors = void 0;
me.prototype.cause = void 0;
me.prototype.fatal = void 0;
me.prototype.place = void 0;
me.prototype.ruleId = void 0;
me.prototype.source = void 0;
import { default as Ze } from 'node:path';
import { default as tb } from 'node:process';
import { fileURLToPath as rb } from 'node:url';
function Ro(e) {
	return Boolean(
		e !== null && typeof e === 'object' && 'href' in e && e.href && 'protocol' in e && e.protocol && e.auth === void 0,
	);
}
var Gc = ['history', 'path', 'basename', 'stem', 'extname', 'dirname'];
class Bo {
	constructor(e) {
		let t;
		if (!e) t = {};
		else if (Ro(e)) t = { path: e };
		else if (typeof e === 'string' || VI(e)) t = { value: e };
		else t = e;
		this.cwd = 'cwd' in t ? '' : tb.cwd(),
			this.data = {},
			this.history = [],
			this.messages = [],
			this.value,
			this.map,
			this.result,
			this.stored;
		let r = -1;
		while (++r < Gc.length) {
			let i = Gc[r];
			if (i in t && t[i] !== void 0 && t[i] !== null) this[i] = i === 'history' ? [...t[i]] : t[i];
		}
		let n;
		for (n in t) if (!Gc.includes(n)) this[n] = t[n];
	}
	get basename() {
		return typeof this.path === 'string' ? Ze.basename(this.path) : void 0;
	}
	set basename(e) {
		Yc(e, 'basename'), Wc(e, 'basename'), this.path = Ze.join(this.dirname || '', e);
	}
	get dirname() {
		return typeof this.path === 'string' ? Ze.dirname(this.path) : void 0;
	}
	set dirname(e) {
		nb(this.basename, 'dirname'), this.path = Ze.join(e || '', this.basename);
	}
	get extname() {
		return typeof this.path === 'string' ? Ze.extname(this.path) : void 0;
	}
	set extname(e) {
		if (Wc(e, 'extname'), nb(this.dirname, 'extname'), e) {
			if (e.codePointAt(0) !== 46) throw Error('`extname` must start with `.`');
			if (e.includes('.', 1)) throw Error('`extname` cannot contain multiple dots');
		}
		this.path = Ze.join(this.dirname, this.stem + (e || ''));
	}
	get path() {
		return this.history[this.history.length - 1];
	}
	set path(e) {
		if (Ro(e)) e = rb(e);
		if (Yc(e, 'path'), this.path !== e) this.history.push(e);
	}
	get stem() {
		return typeof this.path === 'string' ? Ze.basename(this.path, this.extname) : void 0;
	}
	set stem(e) {
		Yc(e, 'stem'), Wc(e, 'stem'), this.path = Ze.join(this.dirname || '', e + (this.extname || ''));
	}
	fail(e, t, r) {
		let n = this.message(e, t, r);
		throw n.fatal = !0, n;
	}
	info(e, t, r) {
		let n = this.message(e, t, r);
		return n.fatal = void 0, n;
	}
	message(e, t, r) {
		let n = new me(e, t, r);
		if (this.path) n.name = this.path + ':' + n.name, n.file = this.path;
		return n.fatal = !1, this.messages.push(n), n;
	}
	toString(e) {
		if (this.value === void 0) return '';
		if (typeof this.value === 'string') return this.value;
		return new TextDecoder(e || void 0).decode(this.value);
	}
}
function Wc(e, t) {
	if (e && e.includes(Ze.sep)) throw Error('`' + t + '` cannot be a path: did not expect `' + Ze.sep + '`');
}
function Yc(e, t) {
	if (!e) throw Error('`' + t + '` cannot be empty');
}
function nb(e, t) {
	if (!e) throw Error('Setting `' + t + '` requires `path` to be set too');
}
function VI(e) {
	return Boolean(e && typeof e === 'object' && 'byteLength' in e && 'byteOffset' in e);
}
var ib = function(e) {
	let n = this.constructor.prototype,
		i = n[e],
		o = function() {
			return i.apply(o, arguments);
		};
	return Object.setPrototypeOf(o, n), o;
};
var KI = {}.hasOwnProperty;
class tu extends ib {
	constructor() {
		super('copy');
		this.Compiler = void 0,
			this.Parser = void 0,
			this.attachers = [],
			this.compiler = void 0,
			this.freezeIndex = -1,
			this.frozen = void 0,
			this.namespace = {},
			this.parser = void 0,
			this.transformers = Hc();
	}
	copy() {
		let e = new tu(), t = -1;
		while (++t < this.attachers.length) {
			let r = this.attachers[t];
			e.use(...r);
		}
		return e.data(jo.default(!0, {}, this.namespace)), e;
	}
	data(e, t) {
		if (typeof e === 'string') {
			if (arguments.length === 2) return eu('data', this.frozen), this.namespace[e] = t, this;
			return KI.call(this.namespace, e) && this.namespace[e] || void 0;
		}
		if (e) return eu('data', this.frozen), this.namespace = e, this;
		return this.namespace;
	}
	freeze() {
		if (this.frozen) return this;
		let e = this;
		while (++this.freezeIndex < this.attachers.length) {
			let [t, ...r] = this.attachers[this.freezeIndex];
			if (r[0] === !1) continue;
			if (r[0] === !0) r[0] = void 0;
			let n = t.call(e, ...r);
			if (typeof n === 'function') this.transformers.use(n);
		}
		return this.frozen = !0, this.freezeIndex = Number.POSITIVE_INFINITY, this;
	}
	parse(e) {
		this.freeze();
		let t = Zo(e), r = this.parser || this.Parser;
		return Qc('parse', r), r(String(t), t);
	}
	process(e, t) {
		let r = this;
		return this.freeze(),
			Qc('process', this.parser || this.Parser),
			Xc('process', this.compiler || this.Compiler),
			t ? n(void 0, t) : new Promise(n);
		function n(i, o) {
			let s = Zo(e), a = r.parse(s);
			r.run(a, s, function(u, l, f) {
				if (u || !l || !f) return c(u);
				let h = l, d = r.stringify(h, f);
				if (HI(d)) f.value = d;
				else f.result = d;
				c(u, f);
			});
			function c(u, l) {
				if (u || !l) o(u);
				else if (i) i(l);
				else b(t, '`done` is defined if `resolve` is not'), t(void 0, l);
			}
		}
	}
	processSync(e) {
		let t = !1, r;
		return this.freeze(),
			Qc('processSync', this.parser || this.Parser),
			Xc('processSync', this.compiler || this.Compiler),
			this.process(e, n),
			sb('processSync', 'process', t),
			b(r, 'we either bailed on an error or have a tree'),
			r;
		function n(i, o) {
			t = !0, Jc(i), r = o;
		}
	}
	run(e, t, r) {
		ob(e), this.freeze();
		let n = this.transformers;
		if (!r && typeof t === 'function') r = t, t = void 0;
		return r ? i(void 0, r) : new Promise(i);
		function i(o, s) {
			b(typeof t !== 'function', '`file` can’t be a `done` anymore, we checked');
			let a = Zo(t);
			n.run(e, a, c);
			function c(u, l, f) {
				let h = l || e;
				if (u) s(u);
				else if (o) o(h);
				else b(r, '`done` is defined if `resolve` is not'), r(void 0, h, f);
			}
		}
	}
	runSync(e, t) {
		let r = !1, n;
		return this.run(e, t, i), sb('runSync', 'run', r), b(n, 'we either bailed on an error or have a tree'), n;
		function i(o, s) {
			Jc(o), n = s, r = !0;
		}
	}
	stringify(e, t) {
		this.freeze();
		let r = Zo(t), n = this.compiler || this.Compiler;
		return Xc('stringify', n), ob(e), n(e, r);
	}
	use(e, ...t) {
		let r = this.attachers, n = this.namespace;
		if (eu('use', this.frozen), e === null || e === void 0);
		else if (typeof e === 'function') a(e, t);
		else if (typeof e === 'object') {
			if (Array.isArray(e)) s(e);
			else o(e);
		} else throw TypeError('Expected usable value, not `' + e + '`');
		return this;
		function i(c) {
			if (typeof c === 'function') a(c, []);
			else if (typeof c === 'object') {
				if (Array.isArray(c)) {
					let [u, ...l] = c;
					a(u, l);
				} else o(c);
			} else throw TypeError('Expected usable value, not `' + c + '`');
		}
		function o(c) {
			if (!('plugins' in c) && !('settings' in c)) {
				throw Error(
					'Expected usable value but received an empty preset, which is probably a mistake: presets typically come with `plugins` and sometimes with `settings`, but this has neither',
				);
			}
			if (s(c.plugins), c.settings) n.settings = jo.default(!0, n.settings, c.settings);
		}
		function s(c) {
			let u = -1;
			if (c === null || c === void 0);
			else if (Array.isArray(c)) {
				while (++u < c.length) {
					let l = c[u];
					i(l);
				}
			} else throw TypeError('Expected a list of plugins, not `' + c + '`');
		}
		function a(c, u) {
			let l = -1, f = -1;
			while (++l < r.length) {
				if (r[l][0] === c) {
					f = l;
					break;
				}
			}
			if (f === -1) r.push([c, ...u]);
			else if (u.length > 0) {
				let [h, ...d] = u, g = r[f][1];
				if (Ln(g) && Ln(h)) h = jo.default(!0, g, h);
				r[f] = [c, h, ...d];
			}
		}
	}
}
var ru = new tu().freeze();
function Qc(e, t) {
	if (typeof t !== 'function') throw TypeError('Cannot `' + e + '` without `parser`');
}
function Xc(e, t) {
	if (typeof t !== 'function') throw TypeError('Cannot `' + e + '` without `compiler`');
}
function eu(e, t) {
	if (t) {
		throw Error(
			'Cannot call `' + e
				+ '` on a frozen processor.\nCreate a new processor first, by calling it: use `processor()` instead of `processor`.',
		);
	}
}
function ob(e) {
	if (!Ln(e) || typeof e.type !== 'string') throw TypeError('Expected node, got `' + e + '`');
}
function sb(e, t, r) {
	if (!r) throw Error('`' + e + '` finished async. Use `' + t + '` instead');
}
function Zo(e) {
	return JI(e) ? e : new Bo(e);
}
function JI(e) {
	return Boolean(e && typeof e === 'object' && 'message' in e && 'messages' in e);
}
function HI(e) {
	return typeof e === 'string' || GI(e);
}
function GI(e) {
	return Boolean(e && typeof e === 'object' && 'byteLength' in e && 'byteOffset' in e);
}
var ab = ru().use(Ao).use(Mo).freeze();
function nu(e, t) {
	let r = String(e);
	if (typeof t !== 'string') throw TypeError('Expected character');
	let n = 0, i = r.indexOf(t);
	while (i !== -1) n++, i = r.indexOf(t, i + t.length);
	return n;
}
function iu(e) {
	if (typeof e !== 'string') throw TypeError('Expected a string');
	return e.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&').replace(/-/g, '\\x2d');
}
function ou(e, t, r) {
	let i = It((r || {}).ignore || []), o = WI(t), s = -1;
	while (++s < o.length) Pn(e, 'text', a);
	function a(u, l) {
		let f = -1, h;
		while (++f < l.length) {
			let d = l[f], g = h ? h.children : void 0;
			if (i(d, g ? g.indexOf(d) : void 0, h)) return;
			h = d;
		}
		if (h) return c(u, l);
	}
	function c(u, l) {
		let f = l[l.length - 1], h = o[s][0], d = o[s][1], g = 0, x = f.children.indexOf(u), k = !1, z = [];
		h.lastIndex = 0;
		let _ = h.exec(u.value);
		while (_) {
			let I = _.index, v = { index: _.index, input: _.input, stack: [...l, u] }, q = d(..._, v);
			if (typeof q === 'string') q = q.length > 0 ? { type: 'text', value: q } : void 0;
			if (q === !1) h.lastIndex = I + 1;
			else {
				if (g !== I) O({ type: 'text', value: u.value.slice(g, I) });
				if (Array.isArray(q)) { for (let L of q) O(L); }
				else if (q) O(q);
				g = I + _[0].length, k = !0;
			}
			if (!h.global) break;
			_ = h.exec(u.value);
		}
		if (k) {
			if (g < u.value.length) O({ type: 'text', value: u.value.slice(g) });
			f.children.splice(x, 1, ...z);
		} else z = [u];
		return x + z.length;
		function O(I) {
			let v = z[z.length - 1];
			if (v && v.type === 'text' && I.type === 'text') v.value += I.value;
			else z.push(I);
		}
	}
}
function WI(e) {
	if (!Array.isArray(e)) throw TypeError('Expected find and replace tuple or list of tuples');
	let t = [], r = !e[0] || Array.isArray(e[0]) ? e : [e], n = -1;
	while (++n < r.length) {
		let i = r[n];
		t.push([YI(i[0]), QI(i[1])]);
	}
	return t;
}
function YI(e) {
	return typeof e === 'string' ? new RegExp(iu(e), 'g') : e;
}
function QI(e) {
	return typeof e === 'function' ? e : function() {
		return e;
	};
}
var su = 'phrasing', au = ['autolink', 'link', 'image', 'label'];
function uu() {
	return {
		transforms: [iP],
		enter: { literalAutolink: XI, literalAutolinkEmail: cu, literalAutolinkHttp: cu, literalAutolinkWww: cu },
		exit: { literalAutolink: nP, literalAutolinkEmail: rP, literalAutolinkHttp: eP, literalAutolinkWww: tP },
	};
}
function lu() {
	return {
		unsafe: [{ character: '@', before: '[+\\-.\\w]', after: '[\\-.\\w]', inConstruct: su, notInConstruct: au }, {
			character: '.',
			before: '[Ww]',
			after: '[\\-.\\w]',
			inConstruct: su,
			notInConstruct: au,
		}, { character: ':', before: '[ps]', after: '\\/', inConstruct: su, notInConstruct: au }],
	};
}
function XI(e) {
	this.enter({ type: 'link', title: null, url: '', children: [] }, e);
}
function cu(e) {
	this.config.enter.autolinkProtocol.call(this, e);
}
function eP(e) {
	this.config.exit.autolinkProtocol.call(this, e);
}
function tP(e) {
	this.config.exit.data.call(this, e);
	let t = this.stack[this.stack.length - 1];
	b(t.type === 'link'), t.url = 'http://' + this.sliceSerialize(e);
}
function rP(e) {
	this.config.exit.autolinkEmail.call(this, e);
}
function nP(e) {
	this.exit(e);
}
function iP(e) {
	ou(e, [[/(https?:\/\/|www(?=\.))([-.\w]+)([^ \t\r\n]*)/gi, oP], [
		/(?<=^|\s|\p{P}|\p{S})([-.\w+]+)@([-\w]+(?:\.[-\w]+)+)/gu,
		sP,
	]], { ignore: ['link', 'linkReference'] });
}
function oP(e, t, r, n, i) {
	let o = '';
	if (!cb(i)) return !1;
	if (/^w/i.test(t)) r = t + r, t = '', o = 'http://';
	if (!aP(r)) return !1;
	let s = cP(r + n);
	if (!s[0]) return !1;
	let a = { type: 'link', title: null, url: o + t + s[0], children: [{ type: 'text', value: t + s[0] }] };
	if (s[1]) return [a, { type: 'text', value: s[1] }];
	return a;
}
function sP(e, t, r, n) {
	if (!cb(n, !0) || /[-\d_]$/.test(r)) return !1;
	return { type: 'link', title: null, url: 'mailto:' + t + '@' + r, children: [{ type: 'text', value: t + '@' + r }] };
}
function aP(e) {
	let t = e.split('.');
	if (
		t.length < 2 || t[t.length - 1] && (/_/.test(t[t.length - 1]) || !/[a-zA-Z\d]/.test(t[t.length - 1]))
		|| t[t.length - 2] && (/_/.test(t[t.length - 2]) || !/[a-zA-Z\d]/.test(t[t.length - 2]))
	) return !1;
	return !0;
}
function cP(e) {
	let t = /[!"&'),.:;<>?\]}]+$/.exec(e);
	if (!t) return [e, void 0];
	e = e.slice(0, t.index);
	let r = t[0], n = r.indexOf(')'), i = nu(e, '('), o = nu(e, ')');
	while (n !== -1 && i > o) e += r.slice(0, n + 1), r = r.slice(n + 1), n = r.indexOf(')'), o++;
	return [e, r];
}
function cb(e, t) {
	let r = e.input.charCodeAt(e.index - 1);
	return (e.index === 0 || Qe(r) || Kt(r)) && (!t || r !== 47);
}
ub.peek = yP;
function uP() {
	this.buffer();
}
function lP(e) {
	this.enter({ type: 'footnoteReference', identifier: '', label: '' }, e);
}
function fP() {
	this.buffer();
}
function pP(e) {
	this.enter({ type: 'footnoteDefinition', identifier: '', label: '', children: [] }, e);
}
function hP(e) {
	let t = this.resume(), r = this.stack[this.stack.length - 1];
	b(r.type === 'footnoteReference'), r.identifier = ye(this.sliceSerialize(e)).toLowerCase(), r.label = t;
}
function dP(e) {
	this.exit(e);
}
function mP(e) {
	let t = this.resume(), r = this.stack[this.stack.length - 1];
	b(r.type === 'footnoteDefinition'), r.identifier = ye(this.sliceSerialize(e)).toLowerCase(), r.label = t;
}
function gP(e) {
	this.exit(e);
}
function yP() {
	return '[';
}
function ub(e, t, r, n) {
	let i = r.createTracker(n), o = i.move('[^'), s = r.enter('footnoteReference'), a = r.enter('reference');
	return o += i.move(r.safe(r.associationId(e), { after: ']', before: o })), a(), s(), o += i.move(']'), o;
}
function fu() {
	return {
		enter: {
			gfmFootnoteCallString: uP,
			gfmFootnoteCall: lP,
			gfmFootnoteDefinitionLabelString: fP,
			gfmFootnoteDefinition: pP,
		},
		exit: {
			gfmFootnoteCallString: hP,
			gfmFootnoteCall: dP,
			gfmFootnoteDefinitionLabelString: mP,
			gfmFootnoteDefinition: gP,
		},
	};
}
function pu(e) {
	let t = !1;
	if (e && e.firstLineBlank) t = !0;
	return {
		handlers: { footnoteDefinition: r, footnoteReference: ub },
		unsafe: [{ character: '[', inConstruct: ['label', 'phrasing', 'reference'] }],
	};
	function r(n, i, o, s) {
		let a = o.createTracker(s), c = a.move('[^'), u = o.enter('footnoteDefinition'), l = o.enter('label');
		if (
			c += a.move(o.safe(o.associationId(n), { before: c, after: ']' })),
				l(),
				c += a.move(']:'),
				n.children && n.children.length > 0
		) {
			a.shift(4),
				c += a.move(
					(t
						? `
`
						: ' ') + o.indentLines(o.containerFlow(n, a.current()), t ? lb : bP),
				);
		}
		return u(), c;
	}
}
function bP(e, t, r) {
	return t === 0 ? e : lb(e, t, r);
}
function lb(e, t, r) {
	return (r ? '' : '    ') + e;
}
var xP = ['autolink', 'destinationLiteral', 'destinationRaw', 'reference', 'titleQuote', 'titleApostrophe'];
mu.attention = SP;
mu.peek = vP;
function hu() {
	return { canContainEols: ['delete'], enter: { strikethrough: kP }, exit: { strikethrough: wP } };
}
function du() {
	return { handlers: { delete: mu }, unsafe: [{ character: '~', inConstruct: 'phrasing', notInConstruct: xP }] };
}
function kP(e) {
	this.enter({ type: 'delete', children: [], position: void 0 }, e);
}
function wP(e) {
	this.exit(e);
}
function mu(e, t, r, n) {
	let i = r.createTracker(n),
		o = r.stack.includes('strikethrough') ? '~' : '~~',
		s = r.enter('strikethrough'),
		a = i.move(o);
	return a += r.containerPhrasing(e, { ...i.current(), before: a, after: '~' }), a += i.move(o), s(), a;
}
function SP() {
	return { construct: 'strikethrough', markers: ['~'], sizes: [2, 1] };
}
function vP() {
	return '~';
}
function _P(e) {
	return e.length;
}
function pb(e, t) {
	let r = t || {},
		n = (r.align || []).concat(),
		i = r.stringLength || _P,
		o = [],
		s = [],
		a = [],
		c = [],
		u = 0,
		l = -1;
	while (++l < e.length) {
		let y = [], x = [], k = -1;
		if (e[l].length > u) u = e[l].length;
		while (++k < e[l].length) {
			let z = CP(e[l][k]);
			if (r.alignDelimiters !== !1) {
				let _ = i(z);
				if (x[k] = _, c[k] === void 0 || _ > c[k]) c[k] = _;
			}
			y.push(z);
		}
		s[l] = y, a[l] = x;
	}
	let f = -1;
	if (typeof n === 'object' && 'length' in n) { while (++f < u) o[f] = fb(n[f]); }
	else {
		let y = fb(n);
		while (++f < u) o[f] = y;
	}
	f = -1;
	let h = [], d = [];
	while (++f < u) {
		let y = o[f], x = '', k = '';
		if (y === 99) x = ':', k = ':';
		else if (y === 108) x = ':';
		else if (y === 114) k = ':';
		let z = r.alignDelimiters === !1 ? 1 : Math.max(1, c[f] - x.length - k.length), _ = x + '-'.repeat(z) + k;
		if (r.alignDelimiters !== !1) {
			if (z = x.length + z + k.length, z > c[f]) c[f] = z;
			d[f] = z;
		}
		h[f] = _;
	}
	s.splice(1, 0, h), a.splice(1, 0, d), l = -1;
	let g = [];
	while (++l < s.length) {
		let y = s[l], x = a[l];
		f = -1;
		let k = [];
		while (++f < u) {
			let z = y[f] || '', _ = '', O = '';
			if (r.alignDelimiters !== !1) {
				let I = c[f] - (x[f] || 0), v = o[f];
				if (v === 114) _ = ' '.repeat(I);
				else if (v === 99) {
					if (I % 2) _ = ' '.repeat(I / 2 + 0.5), O = ' '.repeat(I / 2 - 0.5);
					else _ = ' '.repeat(I / 2), O = _;
				} else O = ' '.repeat(I);
			}
			if (r.delimiterStart !== !1 && !f) k.push('|');
			if (r.padding !== !1 && !(r.alignDelimiters === !1 && z === '') && (r.delimiterStart !== !1 || f)) k.push(' ');
			if (r.alignDelimiters !== !1) k.push(_);
			if (k.push(z), r.alignDelimiters !== !1) k.push(O);
			if (r.padding !== !1) k.push(' ');
			if (r.delimiterEnd !== !1 || f !== u - 1) k.push('|');
		}
		g.push(r.delimiterEnd === !1 ? k.join('').replace(/ +$/, '') : k.join(''));
	}
	return g.join(`
`);
}
function CP(e) {
	return e === null || e === void 0 ? '' : String(e);
}
function fb(e) {
	let t = typeof e === 'string' ? e.codePointAt(0) : 0;
	return t === 67 || t === 99 ? 99 : t === 76 || t === 108 ? 108 : t === 82 || t === 114 ? 114 : 0;
}
function yu() {
	return {
		enter: { table: zP, tableData: hb, tableHeader: hb, tableRow: AP },
		exit: { codeText: EP, table: TP, tableData: gu, tableHeader: gu, tableRow: gu },
	};
}
function zP(e) {
	let t = e._align;
	b(t, 'expected `_align` on table'),
		this.enter({
			type: 'table',
			align: t.map(function(r) {
				return r === 'none' ? null : r;
			}),
			children: [],
		}, e),
		this.data.inTable = !0;
}
function TP(e) {
	this.exit(e), this.data.inTable = void 0;
}
function AP(e) {
	this.enter({ type: 'tableRow', children: [] }, e);
}
function gu(e) {
	this.exit(e);
}
function hb(e) {
	this.enter({ type: 'tableCell', children: [] }, e);
}
function EP(e) {
	let t = this.resume();
	if (this.data.inTable) t = t.replace(/\\([\\|])/g, IP);
	let r = this.stack[this.stack.length - 1];
	b(r.type === 'inlineCode'), r.value = t, this.exit(e);
}
function IP(e, t) {
	return t === '|' ? t : e;
}
function bu(e) {
	let t = e || {}, { tableCellPadding: r, tablePipeAlign: n, stringLength: i } = t, o = r ? ' ' : '|';
	return {
		unsafe: [
			{ character: '\r', inConstruct: 'tableCell' },
			{
				character: `
`,
				inConstruct: 'tableCell',
			},
			{ atBreak: !0, character: '|', after: '[\t :-]' },
			{ character: '|', inConstruct: 'tableCell' },
			{ atBreak: !0, character: ':', after: '-' },
			{ atBreak: !0, character: '-', after: '[:|-]' },
		],
		handlers: { inlineCode: h, table: s, tableCell: c, tableRow: a },
	};
	function s(d, g, y, x) {
		return u(l(d, y, x), d.align);
	}
	function a(d, g, y, x) {
		let k = f(d, y, x), z = u([k]);
		return z.slice(
			0,
			z.indexOf(`
`),
		);
	}
	function c(d, g, y, x) {
		let k = y.enter('tableCell'), z = y.enter('phrasing'), _ = y.containerPhrasing(d, { ...x, before: o, after: o });
		return z(), k(), _;
	}
	function u(d, g) {
		return pb(d, { align: g, alignDelimiters: n, padding: r, stringLength: i });
	}
	function l(d, g, y) {
		let x = d.children, k = -1, z = [], _ = g.enter('table');
		while (++k < x.length) z[k] = f(x[k], g, y);
		return _(), z;
	}
	function f(d, g, y) {
		let x = d.children, k = -1, z = [], _ = g.enter('tableRow');
		while (++k < x.length) z[k] = c(x[k], d, g, y);
		return _(), z;
	}
	function h(d, g, y) {
		let x = er.inlineCode(d, g, y);
		if (y.stack.includes('tableCell')) x = x.replace(/\|/g, '\\$&');
		return x;
	}
}
function xu() {
	return { exit: { taskListCheckValueChecked: db, taskListCheckValueUnchecked: db, paragraph: PP } };
}
function ku() {
	return { unsafe: [{ atBreak: !0, character: '-', after: '[:|-]' }], handlers: { listItem: OP } };
}
function db(e) {
	let t = this.stack[this.stack.length - 2];
	b(t.type === 'listItem'), t.checked = e.type === 'taskListCheckValueChecked';
}
function PP(e) {
	let t = this.stack[this.stack.length - 2];
	if (t && t.type === 'listItem' && typeof t.checked === 'boolean') {
		let r = this.stack[this.stack.length - 1];
		b(r.type === 'paragraph');
		let n = r.children[0];
		if (n && n.type === 'text') {
			let i = t.children, o = -1, s;
			while (++o < i.length) {
				let a = i[o];
				if (a.type === 'paragraph') {
					s = a;
					break;
				}
			}
			if (s === r) {
				if (n.value = n.value.slice(1), n.value.length === 0) r.children.shift();
				else if (r.position && n.position && typeof n.position.start.offset === 'number') {
					n.position.start.column++, n.position.start.offset++, r.position.start = Object.assign({}, n.position.start);
				}
			}
		}
	}
	this.exit(e);
}
function OP(e, t, r, n) {
	let i = e.children[0],
		o = typeof e.checked === 'boolean' && i && i.type === 'paragraph',
		s = '[' + (e.checked ? 'x' : ' ') + '] ',
		a = r.createTracker(n);
	if (o) a.move(s);
	let c = er.listItem(e, t, r, { ...n, ...a.current() });
	if (o) c = c.replace(/^(?:[*+-]|\d+\.)([\r\n]| {1,3})/, u);
	return c;
	function u(l) {
		return l + s;
	}
}
function wu() {
	return [uu(), fu(), hu(), yu(), xu()];
}
function Su(e) {
	return { extensions: [lu(), pu(e), du(), bu(e), ku()] };
}
var $P = { tokenize: MP, partial: !0 },
	mb = { tokenize: FP, partial: !0 },
	gb = { tokenize: RP, partial: !0 },
	yb = { tokenize: BP, partial: !0 },
	LP = { tokenize: ZP, partial: !0 },
	bb = { name: 'wwwAutolink', tokenize: qP, previous: kb },
	xb = { name: 'protocolAutolink', tokenize: DP, previous: wb },
	lt = { name: 'emailAutolink', tokenize: NP, previous: Sb },
	et = {};
function _u() {
	return { text: et };
}
var rr = p.digit0;
while (rr < p.leftCurlyBrace) {
	if (et[rr] = lt, rr++, rr === p.colon) rr = p.uppercaseA;
	else if (rr === p.leftSquareBracket) rr = p.lowercaseA;
}
et[p.plusSign] = lt;
et[p.dash] = lt;
et[p.dot] = lt;
et[p.underscore] = lt;
et[p.uppercaseH] = [lt, xb];
et[p.lowercaseH] = [lt, xb];
et[p.uppercaseW] = [lt, bb];
et[p.lowercaseW] = [lt, bb];
function NP(e, t, r) {
	let n = this, i, o;
	return s;
	function s(f) {
		if (!vu(f) || !Sb.call(n, n.previous) || Cu(n.events)) return r(f);
		return e.enter('literalAutolink'), e.enter('literalAutolinkEmail'), a(f);
	}
	function a(f) {
		if (vu(f)) return e.consume(f), a;
		if (f === p.atSign) return e.consume(f), c;
		return r(f);
	}
	function c(f) {
		if (f === p.dot) return e.check(LP, l, u)(f);
		if (f === p.dash || f === p.underscore || ae(f)) return o = !0, e.consume(f), c;
		return l(f);
	}
	function u(f) {
		return e.consume(f), i = !0, c;
	}
	function l(f) {
		if (o && i && oe(n.previous)) return e.exit('literalAutolinkEmail'), e.exit('literalAutolink'), t(f);
		return r(f);
	}
}
function qP(e, t, r) {
	let n = this;
	return i;
	function i(s) {
		if (s !== p.uppercaseW && s !== p.lowercaseW || !kb.call(n, n.previous) || Cu(n.events)) return r(s);
		return e.enter('literalAutolink'),
			e.enter('literalAutolinkWww'),
			e.check($P, e.attempt(mb, e.attempt(gb, o), r), r)(s);
	}
	function o(s) {
		return e.exit('literalAutolinkWww'), e.exit('literalAutolink'), t(s);
	}
}
function DP(e, t, r) {
	let n = this, i = '', o = !1;
	return s;
	function s(f) {
		if ((f === p.uppercaseH || f === p.lowercaseH) && wb.call(n, n.previous) && !Cu(n.events)) {
			return e.enter('literalAutolink'), e.enter('literalAutolinkHttp'), i += String.fromCodePoint(f), e.consume(f), a;
		}
		return r(f);
	}
	function a(f) {
		if (oe(f) && i.length < 5) return i += String.fromCodePoint(f), e.consume(f), a;
		if (f === p.colon) {
			let h = i.toLowerCase();
			if (h === 'http' || h === 'https') return e.consume(f), c;
		}
		return r(f);
	}
	function c(f) {
		if (f === p.slash) {
			if (e.consume(f), o) return u;
			return o = !0, c;
		}
		return r(f);
	}
	function u(f) {
		return f === p.eof || Vt(f) || G(f) || Qe(f) || Kt(f) ? r(f) : e.attempt(mb, e.attempt(gb, l), r)(f);
	}
	function l(f) {
		return e.exit('literalAutolinkHttp'), e.exit('literalAutolink'), t(f);
	}
}
function MP(e, t, r) {
	let n = 0;
	return i;
	function i(s) {
		if ((s === p.uppercaseW || s === p.lowercaseW) && n < 3) return n++, e.consume(s), i;
		if (s === p.dot && n === 3) return e.consume(s), o;
		return r(s);
	}
	function o(s) {
		return s === p.eof ? r(s) : t(s);
	}
}
function FP(e, t, r) {
	let n, i, o;
	return s;
	function s(u) {
		if (u === p.dot || u === p.underscore) return e.check(yb, c, a)(u);
		if (u === p.eof || G(u) || Qe(u) || u !== p.dash && Kt(u)) return c(u);
		return o = !0, e.consume(u), s;
	}
	function a(u) {
		if (u === p.underscore) n = !0;
		else i = n, n = void 0;
		return e.consume(u), s;
	}
	function c(u) {
		if (i || n || !o) return r(u);
		return t(u);
	}
}
function RP(e, t) {
	let r = 0, n = 0;
	return i;
	function i(s) {
		if (s === p.leftParenthesis) return r++, e.consume(s), i;
		if (s === p.rightParenthesis && n < r) return o(s);
		if (
			s === p.exclamationMark || s === p.quotationMark || s === p.ampersand || s === p.apostrophe
			|| s === p.rightParenthesis || s === p.asterisk || s === p.comma || s === p.dot || s === p.colon
			|| s === p.semicolon || s === p.lessThan || s === p.questionMark || s === p.rightSquareBracket
			|| s === p.underscore || s === p.tilde
		) return e.check(yb, t, o)(s);
		if (s === p.eof || G(s) || Qe(s)) return t(s);
		return e.consume(s), i;
	}
	function o(s) {
		if (s === p.rightParenthesis) n++;
		return e.consume(s), i;
	}
}
function BP(e, t, r) {
	return n;
	function n(a) {
		if (
			a === p.exclamationMark || a === p.quotationMark || a === p.apostrophe || a === p.rightParenthesis
			|| a === p.asterisk || a === p.comma || a === p.dot || a === p.colon || a === p.semicolon || a === p.questionMark
			|| a === p.underscore || a === p.tilde
		) return e.consume(a), n;
		if (a === p.ampersand) return e.consume(a), o;
		if (a === p.rightSquareBracket) return e.consume(a), i;
		if (a === p.lessThan || a === p.eof || G(a) || Qe(a)) return t(a);
		return r(a);
	}
	function i(a) {
		if (a === p.eof || a === p.leftParenthesis || a === p.leftSquareBracket || G(a) || Qe(a)) return t(a);
		return n(a);
	}
	function o(a) {
		return oe(a) ? s(a) : r(a);
	}
	function s(a) {
		if (a === p.semicolon) return e.consume(a), n;
		if (oe(a)) return e.consume(a), s;
		return r(a);
	}
}
function ZP(e, t, r) {
	return n;
	function n(o) {
		return e.consume(o), i;
	}
	function i(o) {
		return ae(o) ? r(o) : t(o);
	}
}
function kb(e) {
	return e === p.eof || e === p.leftParenthesis || e === p.asterisk || e === p.underscore || e === p.leftSquareBracket
		|| e === p.rightSquareBracket || e === p.tilde || G(e);
}
function wb(e) {
	return !oe(e);
}
function Sb(e) {
	return !(e === p.slash || vu(e));
}
function vu(e) {
	return e === p.plusSign || e === p.dash || e === p.dot || e === p.underscore || ae(e);
}
function Cu(e) {
	let t = e.length, r = !1;
	while (t--) {
		let n = e[t][1];
		if ((n.type === 'labelLink' || n.type === 'labelImage') && !n._balanced) {
			r = !0;
			break;
		}
		if (n._gfmAutolinkLiteralWalkedInto) {
			r = !1;
			break;
		}
	}
	if (e.length > 0 && !r) e[e.length - 1][1]._gfmAutolinkLiteralWalkedInto = !0;
	return r;
}
var jP = { tokenize: WP, partial: !0 };
function zu() {
	return {
		document: {
			[p.leftSquareBracket]: { name: 'gfmFootnoteDefinition', tokenize: JP, continuation: { tokenize: HP }, exit: GP },
		},
		text: {
			[p.leftSquareBracket]: { name: 'gfmFootnoteCall', tokenize: KP },
			[p.rightSquareBracket]: { name: 'gfmPotentialFootnoteCall', add: 'after', tokenize: UP, resolveTo: VP },
		},
	};
}
function UP(e, t, r) {
	let n = this, i = n.events.length, o = n.parser.gfmFootnotes || (n.parser.gfmFootnotes = []), s;
	while (i--) {
		let c = n.events[i][1];
		if (c.type === m.labelImage) {
			s = c;
			break;
		}
		if (
			c.type === 'gfmFootnoteCall' || c.type === m.labelLink || c.type === m.label || c.type === m.image
			|| c.type === m.link
		) break;
	}
	return a;
	function a(c) {
		if (b(c === p.rightSquareBracket, 'expected `]`'), !s || !s._balanced) return r(c);
		let u = ye(n.sliceSerialize({ start: s.end, end: n.now() }));
		if (u.codePointAt(0) !== p.caret || !o.includes(u.slice(1))) return r(c);
		return e.enter('gfmFootnoteCallLabelMarker'), e.consume(c), e.exit('gfmFootnoteCallLabelMarker'), t(c);
	}
}
function VP(e, t) {
	let r = e.length, n;
	while (r--) {
		if (e[r][1].type === m.labelImage && e[r][0] === 'enter') {
			n = e[r][1];
			break;
		}
	}
	b(n, 'expected `labelStart` to resolve'), e[r + 1][1].type = m.data, e[r + 3][1].type = 'gfmFootnoteCallLabelMarker';
	let i = {
			type: 'gfmFootnoteCall',
			start: Object.assign({}, e[r + 3][1].start),
			end: Object.assign({}, e[e.length - 1][1].end),
		},
		o = {
			type: 'gfmFootnoteCallMarker',
			start: Object.assign({}, e[r + 3][1].end),
			end: Object.assign({}, e[r + 3][1].end),
		};
	o.end.column++, o.end.offset++, o.end._bufferIndex++;
	let s = {
			type: 'gfmFootnoteCallString',
			start: Object.assign({}, o.end),
			end: Object.assign({}, e[e.length - 1][1].start),
		},
		a = {
			type: m.chunkString,
			contentType: 'string',
			start: Object.assign({}, s.start),
			end: Object.assign({}, s.end),
		},
		c = [
			e[r + 1],
			e[r + 2],
			['enter', i, t],
			e[r + 3],
			e[r + 4],
			['enter', o, t],
			['exit', o, t],
			['enter', s, t],
			['enter', a, t],
			['exit', a, t],
			['exit', s, t],
			e[e.length - 2],
			e[e.length - 1],
			['exit', i, t],
		];
	return e.splice(r, e.length - r + 1, ...c), e;
}
function KP(e, t, r) {
	let n = this, i = n.parser.gfmFootnotes || (n.parser.gfmFootnotes = []), o = 0, s;
	return a;
	function a(f) {
		return b(f === p.leftSquareBracket, 'expected `[`'),
			e.enter('gfmFootnoteCall'),
			e.enter('gfmFootnoteCallLabelMarker'),
			e.consume(f),
			e.exit('gfmFootnoteCallLabelMarker'),
			c;
	}
	function c(f) {
		if (f !== p.caret) return r(f);
		return e.enter('gfmFootnoteCallMarker'),
			e.consume(f),
			e.exit('gfmFootnoteCallMarker'),
			e.enter('gfmFootnoteCallString'),
			e.enter('chunkString').contentType = 'string',
			u;
	}
	function u(f) {
		if (
			o > P.linkReferenceSizeMax || f === p.rightSquareBracket && !s || f === p.eof || f === p.leftSquareBracket || G(f)
		) return r(f);
		if (f === p.rightSquareBracket) {
			e.exit('chunkString');
			let h = e.exit('gfmFootnoteCallString');
			if (!i.includes(ye(n.sliceSerialize(h)))) return r(f);
			return e.enter('gfmFootnoteCallLabelMarker'),
				e.consume(f),
				e.exit('gfmFootnoteCallLabelMarker'),
				e.exit('gfmFootnoteCall'),
				t;
		}
		if (!G(f)) s = !0;
		return o++, e.consume(f), f === p.backslash ? l : u;
	}
	function l(f) {
		if (f === p.leftSquareBracket || f === p.backslash || f === p.rightSquareBracket) return e.consume(f), o++, u;
		return u(f);
	}
}
function JP(e, t, r) {
	let n = this, i = n.parser.gfmFootnotes || (n.parser.gfmFootnotes = []), o, s = 0, a;
	return c;
	function c(g) {
		return b(g === p.leftSquareBracket, 'expected `[`'),
			e.enter('gfmFootnoteDefinition')._container = !0,
			e.enter('gfmFootnoteDefinitionLabel'),
			e.enter('gfmFootnoteDefinitionLabelMarker'),
			e.consume(g),
			e.exit('gfmFootnoteDefinitionLabelMarker'),
			u;
	}
	function u(g) {
		if (g === p.caret) {
			return e.enter('gfmFootnoteDefinitionMarker'),
				e.consume(g),
				e.exit('gfmFootnoteDefinitionMarker'),
				e.enter('gfmFootnoteDefinitionLabelString'),
				e.enter('chunkString').contentType = 'string',
				l;
		}
		return r(g);
	}
	function l(g) {
		if (
			s > P.linkReferenceSizeMax || g === p.rightSquareBracket && !a || g === p.eof || g === p.leftSquareBracket || G(g)
		) return r(g);
		if (g === p.rightSquareBracket) {
			e.exit('chunkString');
			let y = e.exit('gfmFootnoteDefinitionLabelString');
			return o = ye(n.sliceSerialize(y)),
				e.enter('gfmFootnoteDefinitionLabelMarker'),
				e.consume(g),
				e.exit('gfmFootnoteDefinitionLabelMarker'),
				e.exit('gfmFootnoteDefinitionLabel'),
				h;
		}
		if (!G(g)) a = !0;
		return s++, e.consume(g), g === p.backslash ? f : l;
	}
	function f(g) {
		if (g === p.leftSquareBracket || g === p.backslash || g === p.rightSquareBracket) return e.consume(g), s++, l;
		return l(g);
	}
	function h(g) {
		if (g === p.colon) {
			if (e.enter('definitionMarker'), e.consume(g), e.exit('definitionMarker'), !i.includes(o)) i.push(o);
			return j(e, d, 'gfmFootnoteDefinitionWhitespace');
		}
		return r(g);
	}
	function d(g) {
		return t(g);
	}
}
function HP(e, t, r) {
	return e.check(Xe, t, e.attempt(jP, t, r));
}
function GP(e) {
	e.exit('gfmFootnoteDefinition');
}
function WP(e, t, r) {
	let n = this;
	return j(e, i, 'gfmFootnoteDefinitionIndent', P.tabSize + 1);
	function i(o) {
		let s = n.events[n.events.length - 1];
		return s && s[1].type === 'gfmFootnoteDefinitionIndent' && s[2].sliceSerialize(s[1], !0).length === P.tabSize
			? t(o)
			: r(o);
	}
}
function Tu(e) {
	let r = (e || {}).singleTilde, n = { name: 'strikethrough', tokenize: o, resolveAll: i };
	if (r === null || r === void 0) r = !0;
	return { text: { [p.tilde]: n }, insideSpan: { null: [n] }, attentionMarkers: { null: [p.tilde] } };
	function i(s, a) {
		let c = -1;
		while (++c < s.length) {
			if (s[c][0] === 'enter' && s[c][1].type === 'strikethroughSequenceTemporary' && s[c][1]._close) {
				let u = c;
				while (u--) {
					if (
						s[u][0] === 'exit' && s[u][1].type === 'strikethroughSequenceTemporary' && s[u][1]._open
						&& s[c][1].end.offset - s[c][1].start.offset === s[u][1].end.offset - s[u][1].start.offset
					) {
						s[c][1].type = 'strikethroughSequence', s[u][1].type = 'strikethroughSequence';
						let l = {
								type: 'strikethrough',
								start: Object.assign({}, s[u][1].start),
								end: Object.assign({}, s[c][1].end),
							},
							f = {
								type: 'strikethroughText',
								start: Object.assign({}, s[u][1].end),
								end: Object.assign({}, s[c][1].start),
							},
							h = [['enter', l, a], ['enter', s[u][1], a], ['exit', s[u][1], a], ['enter', f, a]],
							d = a.parser.constructs.insideSpan.null;
						if (d) he(h, h.length, 0, zt(d, s.slice(u + 1, c), a));
						he(h, h.length, 0, [['exit', f, a], ['enter', s[c][1], a], ['exit', s[c][1], a], ['exit', l, a]]),
							he(s, u - 1, c - u + 3, h),
							c = u + h.length - 2;
						break;
					}
				}
			}
		}
		c = -1;
		while (++c < s.length) if (s[c][1].type === 'strikethroughSequenceTemporary') s[c][1].type = m.data;
		return s;
	}
	function o(s, a, c) {
		let u = this.previous, l = this.events, f = 0;
		return h;
		function h(g) {
			if (b(g === p.tilde, 'expected `~`'), u === p.tilde && l[l.length - 1][1].type !== m.characterEscape) return c(g);
			return s.enter('strikethroughSequenceTemporary'), d(g);
		}
		function d(g) {
			let y = Se(u);
			if (g === p.tilde) {
				if (f > 1) return c(g);
				return s.consume(g), f++, d;
			}
			if (f < 2 && !r) return c(g);
			let x = s.exit('strikethroughSequenceTemporary'), k = Se(g);
			return x._open = !k || k === P.attentionSideAfter && Boolean(y),
				x._close = !y || y === P.attentionSideAfter && Boolean(k),
				a(g);
		}
	}
}
class Au {
	constructor() {
		this.map = [], this.index = new Map();
	}
	add(e, t, r) {
		YP(this, e, t, r);
	}
	consume(e) {
		if (
			this.map.sort(function(i, o) {
				return i[0] - o[0];
			}), this.map.length === 0
		) return;
		let t = this.map.length, r = [];
		while (t > 0) t -= 1, r.push(e.slice(this.map[t][0] + this.map[t][1]), this.map[t][2]), e.length = this.map[t][0];
		r.push(e.slice()), e.length = 0;
		let n = r.pop();
		while (n) {
			for (let i of n) e.push(i);
			n = r.pop();
		}
		this.map.length = 0, this.index.clear();
	}
}
function YP(e, t, r, n) {
	if (r === 0 && n.length === 0) return;
	let i = e.index.get(t);
	if (i) {
		i[1] += r, i[2].push(...n);
		return;
	}
	let o = [t, r, n];
	e.map.push(o), e.index.set(t, o);
}
function vb(e, t) {
	b(e[t][1].type === 'table', 'expected table');
	let r = !1, n = [];
	while (t < e.length) {
		let i = e[t];
		if (r) {
			if (i[0] === 'enter') {
				if (i[1].type === 'tableContent') n.push(e[t + 1][1].type === 'tableDelimiterMarker' ? 'left' : 'none');
			} else if (i[1].type === 'tableContent') {
				if (e[t - 1][1].type === 'tableDelimiterMarker') {
					let o = n.length - 1;
					n[o] = n[o] === 'left' ? 'center' : 'right';
				}
			} else if (i[1].type === 'tableDelimiterRow') break;
		} else if (i[0] === 'enter' && i[1].type === 'tableDelimiterRow') r = !0;
		t += 1;
	}
	return n;
}
function Eu() {
	return { flow: { null: { name: 'table', tokenize: QP, resolveAll: XP } } };
}
function QP(e, t, r) {
	let n = this, i = 0, o = 0, s;
	return a;
	function a(C) {
		let J = n.events.length - 1;
		while (J > -1) {
			let { type: V } = n.events[J][1];
			if (V === m.lineEnding || V === m.linePrefix) J--;
			else break;
		}
		let Z = J > -1 ? n.events[J][1].type : null, M = Z === 'tableHead' || Z === 'tableRow' ? v : c;
		if (M === v && n.parser.lazy[n.now().line]) return r(C);
		return M(C);
	}
	function c(C) {
		return e.enter('tableHead'), e.enter('tableRow'), u(C);
	}
	function u(C) {
		if (C === p.verticalBar) return l(C);
		return s = !0, o += 1, l(C);
	}
	function l(C) {
		if (C === p.eof) return r(C);
		if (N(C)) {
			if (o > 1) {
				return o = 0,
					n.interrupt = !0,
					e.exit('tableRow'),
					e.enter(m.lineEnding),
					e.consume(C),
					e.exit(m.lineEnding),
					d;
			}
			return r(C);
		}
		if (R(C)) return j(e, l, m.whitespace)(C);
		if (o += 1, s) s = !1, i += 1;
		if (C === p.verticalBar) return e.enter('tableCellDivider'), e.consume(C), e.exit('tableCellDivider'), s = !0, l;
		return e.enter(m.data), f(C);
	}
	function f(C) {
		if (C === p.eof || C === p.verticalBar || G(C)) return e.exit(m.data), l(C);
		return e.consume(C), C === p.backslash ? h : f;
	}
	function h(C) {
		if (C === p.backslash || C === p.verticalBar) return e.consume(C), f;
		return f(C);
	}
	function d(C) {
		if (n.interrupt = !1, n.parser.lazy[n.now().line]) return r(C);
		if (e.enter('tableDelimiterRow'), s = !1, R(C)) {
			return b(n.parser.constructs.disable.null, 'expected `disabled.null`'),
				j(e, g, m.linePrefix, n.parser.constructs.disable.null.includes('codeIndented') ? void 0 : P.tabSize)(C);
		}
		return g(C);
	}
	function g(C) {
		if (C === p.dash || C === p.colon) return x(C);
		if (C === p.verticalBar) return s = !0, e.enter('tableCellDivider'), e.consume(C), e.exit('tableCellDivider'), y;
		return I(C);
	}
	function y(C) {
		if (R(C)) return j(e, x, m.whitespace)(C);
		return x(C);
	}
	function x(C) {
		if (C === p.colon) {
			return o += 1, s = !0, e.enter('tableDelimiterMarker'), e.consume(C), e.exit('tableDelimiterMarker'), k;
		}
		if (C === p.dash) return o += 1, k(C);
		if (C === p.eof || N(C)) return O(C);
		return I(C);
	}
	function k(C) {
		if (C === p.dash) return e.enter('tableDelimiterFiller'), z(C);
		return I(C);
	}
	function z(C) {
		if (C === p.dash) return e.consume(C), z;
		if (C === p.colon) {
			return s = !0,
				e.exit('tableDelimiterFiller'),
				e.enter('tableDelimiterMarker'),
				e.consume(C),
				e.exit('tableDelimiterMarker'),
				_;
		}
		return e.exit('tableDelimiterFiller'), _(C);
	}
	function _(C) {
		if (R(C)) return j(e, O, m.whitespace)(C);
		return O(C);
	}
	function O(C) {
		if (C === p.verticalBar) return g(C);
		if (C === p.eof || N(C)) {
			if (!s || i !== o) return I(C);
			return e.exit('tableDelimiterRow'), e.exit('tableHead'), t(C);
		}
		return I(C);
	}
	function I(C) {
		return r(C);
	}
	function v(C) {
		return e.enter('tableRow'), q(C);
	}
	function q(C) {
		if (C === p.verticalBar) return e.enter('tableCellDivider'), e.consume(C), e.exit('tableCellDivider'), q;
		if (C === p.eof || N(C)) return e.exit('tableRow'), t(C);
		if (R(C)) return j(e, q, m.whitespace)(C);
		return e.enter(m.data), L(C);
	}
	function L(C) {
		if (C === p.eof || C === p.verticalBar || G(C)) return e.exit(m.data), q(C);
		return e.consume(C), C === p.backslash ? U : L;
	}
	function U(C) {
		if (C === p.backslash || C === p.verticalBar) return e.consume(C), L;
		return L(C);
	}
}
function XP(e, t) {
	let r = -1, n = !0, i = 0, o = [0, 0, 0, 0], s = [0, 0, 0, 0], a = !1, c = 0, u, l, f, h = new Au();
	while (++r < e.length) {
		let d = e[r], g = d[1];
		if (d[0] === 'enter') {
			if (g.type === 'tableHead') {
				if (a = !1, c !== 0) b(u, 'there should be a table opening'), _b(h, t, c, u, l), l = void 0, c = 0;
				u = { type: 'table', start: Object.assign({}, g.start), end: Object.assign({}, g.end) },
					h.add(r, 0, [['enter', u, t]]);
			} else if (g.type === 'tableRow' || g.type === 'tableDelimiterRow') {
				if (n = !0, f = void 0, o = [0, 0, 0, 0], s = [0, r + 1, 0, 0], a) {
					a = !1,
						l = { type: 'tableBody', start: Object.assign({}, g.start), end: Object.assign({}, g.end) },
						h.add(r, 0, [['enter', l, t]]);
				}
				i = g.type === 'tableDelimiterRow' ? 2 : l ? 3 : 1;
			} else if (
				i && (g.type === m.data || g.type === 'tableDelimiterMarker' || g.type === 'tableDelimiterFiller')
			) {
				if (n = !1, s[2] === 0) {
					if (o[1] !== 0) s[0] = s[1], f = Uo(h, t, o, i, void 0, f), o = [0, 0, 0, 0];
					s[2] = r;
				}
			} else if (g.type === 'tableCellDivider') {
				if (n) n = !1;
				else {
					if (o[1] !== 0) s[0] = s[1], f = Uo(h, t, o, i, void 0, f);
					o = s, s = [o[1], r, 0, 0];
				}
			}
		} else if (g.type === 'tableHead') a = !0, c = r;
		else if (g.type === 'tableRow' || g.type === 'tableDelimiterRow') {
			if (c = r, o[1] !== 0) s[0] = s[1], f = Uo(h, t, o, i, r, f);
			else if (s[1] !== 0) f = Uo(h, t, s, i, r, f);
			i = 0;
		} else if (i && (g.type === m.data || g.type === 'tableDelimiterMarker' || g.type === 'tableDelimiterFiller')) {
			s[3] = r;
		}
	}
	if (c !== 0) b(u, 'expected table opening'), _b(h, t, c, u, l);
	h.consume(t.events), r = -1;
	while (++r < t.events.length) {
		let d = t.events[r];
		if (d[0] === 'enter' && d[1].type === 'table') d[1]._align = vb(t.events, r);
	}
	return e;
}
function Uo(e, t, r, n, i, o) {
	let s = n === 1 ? 'tableHeader' : n === 2 ? 'tableDelimiter' : 'tableData', a = 'tableContent';
	if (r[0] !== 0) {
		b(o, 'expected previous cell enter'),
			o.end = Object.assign({}, Pr(t.events, r[0])),
			e.add(r[0], 0, [['exit', o, t]]);
	}
	let c = Pr(t.events, r[1]);
	if (
		o = { type: s, start: Object.assign({}, c), end: Object.assign({}, c) },
			e.add(r[1], 0, [['enter', o, t]]),
			r[2] !== 0
	) {
		let u = Pr(t.events, r[2]),
			l = Pr(t.events, r[3]),
			f = { type: 'tableContent', start: Object.assign({}, u), end: Object.assign({}, l) };
		if (e.add(r[2], 0, [['enter', f, t]]), b(r[3] !== 0), n !== 2) {
			let h = t.events[r[2]], d = t.events[r[3]];
			if (
				h[1].end = Object.assign({}, d[1].end),
					h[1].type = m.chunkText,
					h[1].contentType = P.contentTypeText,
					r[3] > r[2] + 1
			) {
				let g = r[2] + 1, y = r[3] - r[2] - 1;
				e.add(g, y, []);
			}
		}
		e.add(r[3] + 1, 0, [['exit', f, t]]);
	}
	if (i !== void 0) o.end = Object.assign({}, Pr(t.events, i)), e.add(i, 0, [['exit', o, t]]), o = void 0;
	return o;
}
function _b(e, t, r, n, i) {
	let o = [], s = Pr(t.events, r);
	if (i) i.end = Object.assign({}, s), o.push(['exit', i, t]);
	n.end = Object.assign({}, s), o.push(['exit', n, t]), e.add(r + 1, 0, o);
}
function Pr(e, t) {
	let r = e[t], n = r[0] === 'enter' ? 'start' : 'end';
	return r[1][n];
}
var eO = { name: 'tasklistCheck', tokenize: tO };
function Iu() {
	return { text: { [p.leftSquareBracket]: eO } };
}
function tO(e, t, r) {
	let n = this;
	return i;
	function i(c) {
		if (b(c === p.leftSquareBracket, 'expected `[`'), n.previous !== p.eof || !n._gfmTasklistFirstContentOfListItem) {
			return r(c);
		}
		return e.enter('taskListCheck'), e.enter('taskListCheckMarker'), e.consume(c), e.exit('taskListCheckMarker'), o;
	}
	function o(c) {
		if (G(c)) return e.enter('taskListCheckValueUnchecked'), e.consume(c), e.exit('taskListCheckValueUnchecked'), s;
		if (c === p.uppercaseX || c === p.lowercaseX) {
			return e.enter('taskListCheckValueChecked'), e.consume(c), e.exit('taskListCheckValueChecked'), s;
		}
		return r(c);
	}
	function s(c) {
		if (c === p.rightSquareBracket) {
			return e.enter('taskListCheckMarker'), e.consume(c), e.exit('taskListCheckMarker'), e.exit('taskListCheck'), a;
		}
		return r(c);
	}
	function a(c) {
		if (N(c)) return t(c);
		if (R(c)) return e.check({ tokenize: rO }, t, r)(c);
		return r(c);
	}
}
function rO(e, t, r) {
	return j(e, n, m.whitespace);
	function n(i) {
		return i === p.eof ? r(i) : t(i);
	}
}
function Cb(e) {
	return uo([_u(), zu(), Tu(e), Eu(), Iu()]);
}
var nO = {};
function Vo(e) {
	let t = this,
		r = e || nO,
		n = t.data(),
		i = n.micromarkExtensions || (n.micromarkExtensions = []),
		o = n.fromMarkdownExtensions || (n.fromMarkdownExtensions = []),
		s = n.toMarkdownExtensions || (n.toMarkdownExtensions = []);
	i.push(Cb(r)), o.push(wu()), s.push(Su(r));
}
var iO = {
		blockquote: Pt,
		break: cO,
		code: je,
		definition: je,
		delete: Pt,
		emphasis: Pt,
		footnoteReference: je,
		footnoteDefinition: je,
		heading: aO,
		html: je,
		image: Tb,
		imageReference: Tb,
		inlineCode: Ab,
		list: Pt,
		listItem: Pt,
		link: Pt,
		linkReference: Pt,
		strong: Pt,
		table: je,
		tableCell: je,
		text: Ab,
		thematicBreak: je,
		toml: je,
		yaml: je,
	},
	oO = {},
	zb = [];
function Ko(e) {
	let t = { ...iO }, r = e || oO, n = r.keep || zb, i = r.remove || zb, o = -1;
	while (++o < i.length) {
		let u = i[o];
		if (typeof u === 'string') t[u] = je;
		else t[u[0]] = u[1];
	}
	let s = {};
	if (n.length === 0) s = t;
	else {
		let u;
		for (u in t) if (!n.includes(u)) s[u] = t[u];
		o = -1;
		while (++o < n.length) {
			if (u = n[o], !Object.hasOwn(t, u)) {
				throw Error(
					'Unknown node type `' + u + "` in `keep`, use a replace tuple with a handle instead: `remove: [['" + u
						+ "', handle]]`",
				);
			}
		}
	}
	return function(u) {
		return a(u);
	};
	function a(u) {
		let l = u.type, f = u;
		if (Object.hasOwn(s, l)) {
			let h = s[l];
			if (h) f = h(f) || void 0;
		}
		if (f = Array.isArray(f) ? c(f) : f, f && 'children' in f) f.children = c(f.children);
		return f;
	}
	function c(u) {
		let l = -1, f = [];
		while (++l < u.length) {
			let h = a(u[l]);
			if (Array.isArray(h)) f.push(...c(h));
			else if (h) f.push(h);
		}
		return sO(f);
	}
}
function sO(e) {
	let t = -1, r = [], n;
	while (++t < e.length) {
		let i = e[t];
		if (n && i.type === n.type && 'value' in i && 'value' in n) n.value += i.value;
		else r.push(i), n = i;
	}
	return r;
}
function Tb(e) {
	let t = 'title' in e ? e.title : '', r = e.alt || t || '';
	return r ? { type: 'text', value: r } : void 0;
}
function Ab(e) {
	return { type: 'text', value: e.value };
}
function aO(e) {
	return { type: 'paragraph', children: e.children };
}
function Pt(e) {
	return e.children;
}
function cO() {
	return {
		type: 'text',
		value: `
`,
	};
}
function je() {
	return;
}
var $u = (e) => ('value' in e) ? e.value : ('children' in e) ? e.children.map($u).join('') : '',
	Pu = (e) => ({ type: 'paragraph', children: [{ type: 'text', value: e }] }),
	uO = (e, t) => t === 0 ? `- ${e}` : e === '' ? e : `  ${e}`,
	Eb = ab().use(Vo).use(Ko, {
		keep: ['list', 'listItem'],
		remove: [['code', (e) => Pu(e.value)], [
			'html',
			(e) => Pu(e.value.replaceAll(/<[^>]*>/g, ' ').replaceAll(/[ \t]+/g, ' ').trim()),
		], ['table', (e) =>
			Pu(
				e.children.map((t) => t.children.map($u).join(' | ')).join(`
`),
			)]],
	}).freeze();
function Ou(e) {
	switch (e.type) {
		case 'paragraph':
			return [$u(e)];
		case 'list':
			return [
				e.children.map((t) =>
					Ou(t).join(`
`).split(`
`).map(uO).join(`
`)
				).join(`
`),
			];
		default:
			return 'children' in e ? e.children.flatMap(Ou) : [];
	}
}
function Ib(e) {
	return Ou(Eb.runSync(Eb.parse(e))).join(`

`);
}
var Ob = ['version', 'installer', 'defaultLocale'],
	Lu = '1.12.0',
	Jo = '(0|[1-9][0-9]{0,3}|[1-5][0-9]{4}|6[0-4][0-9]{3}|65[0-4][0-9]{2}|655[0-2][0-9]|6553[0-5])',
	Nn = (e) => new Set(e.map((t) => JSON.stringify(t))).size === e.length,
	Nu = Q().regex(/^[^.\s\\/:*?"<>|\x01-\x1f]{1,32}(\.[^.\s\\/:*?"<>|\x01-\x1f]{1,32}){1,7}$/).max(128).describe(
		'The package unique identifier',
	),
	qu = Q().regex(/^[^\\/:*?"<>|\x01-\x1f]+$/).max(128).describe('The package version'),
	Du = Q().regex(/^([a-zA-Z]{2,3}|[iI]-[a-zA-Z]+|[xX]-[a-zA-Z]{1,8})(-[a-zA-Z]{1,8})*$/).max(20),
	Mu = (e) => xg(e).describe('The manifest type'),
	Fu = Q().regex(new RegExp(`^${Jo}(\\.${Jo}){2}$`)).describe('The manifest syntax version'),
	fO = Q().regex(new RegExp(`^${Jo}(\\.${Jo}){0,3}$`)),
	Ot = Q().regex(/^([Hh][Tt][Tt][Pp][Ss]?):\/\/.+$/).max(2048),
	Pb = Q().regex(/^[A-Fa-f0-9]{64}$/),
	pO = co().min(-2147483648).max(4294967295).refine((e) => e !== 0).describe(
		'An exit code that can be returned by the installer after execution',
	),
	Ho = Ne({
		PackageIdentifier: Nu,
		PackageVersion: qu,
		DefaultLocale: Du.describe('The default package meta-data locale'),
		ManifestType: Mu('version'),
		ManifestVersion: Fu,
	}),
	qn = Ne({
		PackageIdentifier: Nu,
		PackageVersion: qu,
		InstallerLocale: Du.optional().describe('The installer meta-data locale'),
		Platform: Le(ut(['Windows.Desktop', 'Windows.Universal'])).max(2).refine(Nn).optional().describe(
			'The installer supported operating system',
		),
		MinimumOSVersion: fO.optional().describe('The installer minimum operating system version'),
		InstallerType: ut([
			'msix',
			'msi',
			'appx',
			'exe',
			'zip',
			'inno',
			'nullsoft',
			'wix',
			'burn',
			'pwa',
			'portable',
			'font',
		]).optional().describe(
			'Enumeration of supported installer types. InstallerType is required in either root level or individual Installer level',
		),
		NestedInstallerType: ut(['msix', 'msi', 'appx', 'exe', 'inno', 'nullsoft', 'wix', 'burn', 'portable', 'font'])
			.optional().describe('Enumeration of supported nested installer types contained inside an archive file'),
		NestedInstallerFiles: Le(
			Ne({
				RelativeFilePath: Q().min(1).max(512).describe('The relative path to the nested installer file'),
				PortableCommandAlias: Q().min(1).max(40).optional().describe(
					'The command alias to be used for calling the package. Only applies to the nested portable package',
				),
			}).describe('A nested installer file contained inside an archive'),
		).max(1024).optional().describe('List of nested installer files contained inside an archive'),
		Scope: ut(['user', 'machine']).optional().describe('Scope indicates if the installer is per user or per machine'),
		InstallerSuccessCodes: Le(pO).max(16).refine(Nn).optional().describe(
			'List of additional non-zero installer success exit codes other than known default values by winget',
		),
		UpgradeBehavior: ut(['install', 'uninstallPrevious', 'deny']).optional().describe('The upgrade method'),
		Commands: Le(Q().min(1).max(40)).max(16).refine(Nn).optional().describe(
			'List of commands or aliases to run the package',
		),
		ReleaseDate: QT().optional().describe('The installer release date'),
		InstallationMetadata: Ne({
			DefaultInstallLocation: Q().min(1).max(2048).optional().describe(
				'Represents the default installed package location. Used for deeper installation detection.',
			),
			Files: Le(
				Ne({
					RelativeFilePath: Q().min(1).max(2048).describe('The relative path to the installed file.'),
					FileSha256: Pb.optional().describe('Optional Sha256 of the installed file.'),
					FileType: ut(['launch', 'uninstall', 'other']).optional().describe(
						'The optional installed file type. If not specified, the file is treated as other.',
					),
					InvocationParameter: Q().min(1).max(2048).optional().describe('Optional parameter for invocable files.'),
					DisplayName: Q().min(1).max(256).optional().describe('Optional display name for invocable files.'),
				}).describe('Represents an installed file.'),
			).max(2048).refine(Nn).optional().describe('List of installed files.'),
		}).optional().describe('Details about the installation. Used for deeper installation detection.'),
		Installers: Le(
			Ne({
				Architecture: ut(['x86', 'x64', 'arm', 'arm64', 'neutral']).describe('The installer target architecture'),
				InstallerUrl: Ot.describe('The installer Url'),
				InstallerSha256: Pb.describe('Sha256 is required. Sha256 of the installer'),
			}),
		).min(1).max(1024),
		ManifestType: Mu('installer'),
		ManifestVersion: Fu,
	}),
	Ru = Ne({
		PackageIdentifier: Nu,
		PackageVersion: qu,
		PackageLocale: Du.describe('The package meta-data locale'),
		Publisher: Q().min(2).max(256).describe('The publisher name'),
		PublisherUrl: Ot.optional().describe('The publisher home page'),
		PublisherSupportUrl: Ot.optional().describe('The publisher support page'),
		Author: Q().min(2).max(256).optional().describe('The package author'),
		PackageName: Q().min(2).max(256).describe('The package name'),
		PackageUrl: Ot.optional().describe('The package home page'),
		License: Q().min(3).max(512).describe('The package license'),
		LicenseUrl: Ot.optional().describe('The license page'),
		Copyright: Q().min(3).max(512).optional().describe('The package copyright'),
		CopyrightUrl: Ot.optional().describe('The package copyright page'),
		ShortDescription: Q().min(3).max(256).describe('The short package description'),
		Description: Q().min(3).max(1e4).optional().describe('The full package description'),
		Tags: Le(Q().min(1).max(40).describe('Package moniker or tag')).max(16).refine(Nn).optional().describe(
			'List of additional package search terms',
		),
		ReleaseNotes: Q().min(1).max(1e4).optional().describe('The package release notes'),
		ReleaseNotesUrl: Ot.optional().describe('The package release notes url'),
		InstallationNotes: Q().min(1).max(1e4).optional().describe(
			'The notes displayed to the user upon completion of a package installation.',
		),
		Documentations: Le(
			Ne({
				DocumentLabel: Q().min(1).max(100).optional().describe(
					'The label of the documentation for providing software guides such as manuals and troubleshooting URLs.',
				),
				DocumentUrl: Ot.optional().describe('The documentation URL.'),
			}),
		).max(256).optional(),
		ManifestType: Mu('defaultLocale'),
		ManifestVersion: Fu,
	});
var hO = Ru.omit({
		PackageIdentifier: !0,
		PackageVersion: !0,
		PackageLocale: !0,
		ReleaseNotes: !0,
		ReleaseNotesUrl: !0,
		ManifestType: !0,
		ManifestVersion: !0,
	}),
	dO = qn.omit({
		PackageIdentifier: !0,
		PackageVersion: !0,
		InstallerLocale: !0,
		ReleaseDate: !0,
		Installers: !0,
		ManifestType: !0,
		ManifestVersion: !0,
	}).extend({ InstallerType: qn.shape.InstallerType.unwrap() }),
	mO = Ne({
		packageIdentifier: Ho.shape.PackageIdentifier,
		defaultLocale: Ho.shape.DefaultLocale.default('en-US'),
		releaseNotesUrl: Q().min(1),
		metadata: hO,
		installer: dO,
		installers: Le(
			Ne({ architecture: qn.shape.Installers.element.shape.Architecture, asset: Q().min(1), url: Q().min(1) }),
		).min(1).max(1024),
	}),
	gO = 1e4;
function yO(e) {
	let t = new Map();
	for (let [r, n] of e.split(/\r?\n/).entries()) {
		if (!n) continue;
		let i = /^([a-fA-F0-9]{64}) [ *](\S+)$/.exec(n);
		if (!i?.[1] || !i[2]) throw Error(`Malformed checksum line ${r + 1}`);
		if (t.has(i[2])) throw Error(`Duplicate checksum for ${i[2]}`);
		t.set(i[2], i[1].toUpperCase());
	}
	return t;
}
function Bu(e, t) {
	return e.replace(/\{([^{}]+)\}/g, (r, n) => {
		if (!Object.hasOwn(t, n)) throw Error(`Unknown template variable ${n}`);
		return t[n];
	});
}
function $b(e) {
	let t = new URL(e);
	if (t.protocol !== 'https:' || t.username || t.password || t.hash) throw Error('Expected an HTTPS release URL');
	return e;
}
function bO(e, t, r = gO) {
	let n = e.replaceAll(
		`\r
`,
		`
`,
	).trim();
	if (n.length <= r) return n;
	let i = `

Full release notes: ${t}`;
	if (i.length >= r) throw Error('Release notes URL exceeds the length limit');
	let o = n.lastIndexOf(
		`

`,
		r - i.length,
	);
	if (o <= 0) o = r - i.length;
	if (/[\uD800-\uDBFF]/.test(n[o - 1] ?? '')) o--;
	return n.slice(0, o).trimEnd() + i;
}
function Lb(e) {
	let t = mO.parse(e.configuration), r = e.version;
	if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(r)) throw Error('Expected stable MAJOR.MINOR.PATCH version');
	let n = e.tag ?? `v${r}`;
	if (!n || /[\x00-\x20?#]/.test(n)) throw Error('Invalid release tag');
	let i = { version: r, tag: encodeURIComponent(n) },
		o = yO(e.checksums),
		s = $b(Bu(t.releaseNotesUrl, i)),
		a = t.installers.map((l) => {
			let f = Bu(l.asset, i);
			if (!f || /[\\/]/.test(f) || f === '.' || f === '..') throw Error('Expected an asset filename');
			let h = o.get(f);
			if (!h) throw Error(`Checksum missing for ${f}`);
			return {
				Architecture: l.architecture,
				InstallerUrl: $b(Bu(l.url, { ...i, asset: encodeURIComponent(f) })),
				InstallerSha256: h,
			};
		});
	if (new Set(a.map((l) => l.Architecture)).size !== a.length) throw Error('Duplicate installer architecture');
	for (let l of [...t.installer.NestedInstallerFiles ?? [], ...t.installer.InstallationMetadata?.Files ?? []]) {
		if (/^[\\/]|^[A-Za-z]:/.test(l.RelativeFilePath) || l.RelativeFilePath.split(/[\\/]/).some((f) => f === '..')) {
			throw Error('Unsafe installer relative path');
		}
	}
	if (
		t.installer.InstallerType === 'zip'
		&& (!t.installer.NestedInstallerType || !t.installer.NestedInstallerFiles?.length)
	) throw Error('ZIP installers require nested installer metadata');
	let c = { PackageIdentifier: t.packageIdentifier, PackageVersion: r, ManifestVersion: Lu },
		u = bO(Ib(e.releaseNotes), s);
	return {
		version: Ho.parse({ ...c, DefaultLocale: t.defaultLocale, ManifestType: 'version' }),
		installer: qn.parse({
			...t.installer,
			...c,
			InstallerLocale: t.defaultLocale,
			ReleaseDate: e.releaseDate,
			Installers: a,
			ManifestType: 'installer',
		}),
		defaultLocale: Ru.parse({
			...t.metadata,
			...c,
			PackageLocale: t.defaultLocale,
			...u ? { ReleaseNotes: u } : {},
			ReleaseNotesUrl: s,
			ManifestType: 'defaultLocale',
		}),
	};
}
function Nb(e) {
	let t = e.version.PackageIdentifier,
		r = e.version.DefaultLocale,
		n = { version: `${t}.yaml`, installer: `${t}.installer.yaml`, defaultLocale: `${t}.locale.${r}.yaml` };
	return Object.fromEntries(
		Ob.map((i) => [
			n[i],
			`# yaml-language-server: $schema=https://aka.ms/winget-manifest.${i}.${Lu}.schema.json

` + ca(e[i], { indentSeq: !1, lineWidth: 0, blockQuote: 'literal' }),
		]),
	);
}
var { values: qb } = _O({
	options: {
		config: { type: 'string' },
		version: { type: 'string' },
		tag: { type: 'string' },
		checksums: { type: 'string' },
		'release-notes': { type: 'string' },
		'release-date': { type: 'string' },
		out: { type: 'string' },
	},
	strict: !0,
});
function Or(e, t) {
	let r = qb[e] ?? process.env[t];
	if (!r) throw Error(`Missing --${e} (${t})`);
	return r;
}
var CO = JSON.parse(await Zu(Or('config', 'WINGET_CONFIG'), 'utf8')),
	zO = Lb({
		configuration: CO,
		version: Or('version', 'WINGET_VERSION'),
		tag: qb.tag || process.env.WINGET_TAG || void 0,
		releaseDate: Or('release-date', 'WINGET_RELEASE_DATE'),
		checksums: await Zu(Or('checksums', 'WINGET_CHECKSUMS'), 'utf8'),
		releaseNotes: await Zu(Or('release-notes', 'WINGET_RELEASE_NOTES'), 'utf8'),
	}),
	ju = vO(Or('out', 'WINGET_OUT'));
await kO(ju, { recursive: !0 });
var Db = [];
for (let [e, t] of Object.entries(Nb(zO))) {
	let r = SO(ju, e);
	await wO(r, t, { flag: 'wx' }), Db.push(r), console.log(r);
}
if (process.env.GITHUB_OUTPUT) {
	let e = `output_${crypto.randomUUID()}`;
	await xO(
		process.env.GITHUB_OUTPUT,
		`directory<<${e}
${ju}
${e}
files=${JSON.stringify(Db)}
`,
	);
}
