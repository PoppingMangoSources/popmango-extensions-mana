/* SPDX-License-Identifier: GPL-3.0-or-later */

// The dependency treats `self` as a browser, but Mana can expose it without a navigator.
const scope = globalThis as unknown as { self?: { navigator?: { userAgent: string } } };
if (scope.self && !scope.self.navigator) scope.self.navigator = { userAgent: "" };
