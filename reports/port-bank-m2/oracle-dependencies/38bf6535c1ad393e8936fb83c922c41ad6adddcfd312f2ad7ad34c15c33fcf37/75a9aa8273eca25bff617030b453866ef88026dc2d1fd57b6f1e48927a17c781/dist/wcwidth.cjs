
//#region src/wcwidth.ts
/**
* @fileoverview
* wcwidth implementation for JavaScript/TypeScript
*
* This module provides functions to calculate the display width of Unicode
* characters and strings in terminal/monospace contexts, compatible with
* the Python wcwidth library and POSIX wcwidth() standard.
*
* Based on Unicode 15.1.0 character width tables.
*/
const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;
/**
* Remove all ANSI escape sequences from a string.
*
* @param text The string to clean
* @returns String with ANSI escape sequences removed
*/
function stripAnsi(text) {
	return text.replace(ANSI_PATTERN, "");
}
/**
* Calculate the display width of a string, ignoring ANSI escape codes
* and accounting for Unicode character widths using wcwidth-compatible logic.
*
* @param text The string to measure
* @returns The display width in terminal columns
*/
function getDisplayWidth(text) {
	const cleanText = stripAnsi(text);
	if (cleanText.length === 0) return 0;
	let width = 0;
	let i = 0;
	while (i < cleanText.length) {
		const code = cleanText.codePointAt(i);
		if (code === void 0) {
			i++;
			continue;
		}
		const charWidth = wcwidth(code);
		if (charWidth >= 0) width += charWidth;
		i += code > 65535 ? 2 : 1;
	}
	return width;
}
/**
* Get the display width of a single Unicode code point.
* Based on wcwidth implementation - returns:
* -1: Non-printable/control character
*  0: Zero-width character (combining marks, etc.)
*  1: Normal width character
*  2: Wide character (East Asian, emoji, etc.)
*
* @param code Unicode code point
* @returns Display width (-1, 0, 1, or 2)
*/
function wcwidth(code) {
	if (code < 32 || code >= 127 && code < 160) return -1;
	if (isZeroWidth(code)) return 0;
	if (isWideCharacter(code)) return 2;
	return 1;
}
const ZERO_WIDTH_RANGES = [
	[768, 879],
	[1155, 1161],
	[1425, 1469],
	[1473, 1474],
	[1476, 1477],
	[1552, 1562],
	[1611, 1631],
	[1750, 1756],
	[1759, 1764],
	[1767, 1768],
	[1770, 1773],
	[1840, 1866],
	[1958, 1968],
	[2027, 2035],
	[2070, 2073],
	[2075, 2083],
	[2085, 2087],
	[2089, 2093],
	[2137, 2139],
	[2259, 2273],
	[2275, 2306],
	[2369, 2376],
	[2385, 2391],
	[2402, 2403],
	[2497, 2500],
	[2530, 2531],
	[2561, 2562],
	[2625, 2626],
	[2631, 2632],
	[2635, 2637],
	[2672, 2673],
	[2689, 2690],
	[2753, 2757],
	[2759, 2760],
	[2786, 2787],
	[2810, 2815],
	[2881, 2884],
	[2901, 2902],
	[2914, 2915],
	[3134, 3136],
	[3142, 3144],
	[3146, 3149],
	[3157, 3158],
	[3170, 3171],
	[3276, 3277],
	[3298, 3299],
	[3328, 3329],
	[3387, 3388],
	[3426, 3427],
	[3538, 3540],
	[3636, 3642],
	[3655, 3662],
	[3764, 3772],
	[3784, 3789],
	[3864, 3865],
	[3953, 3966],
	[3968, 3972],
	[3974, 3975],
	[3981, 3991],
	[3993, 4028],
	[4141, 4144],
	[4146, 4151],
	[4153, 4154],
	[4157, 4158],
	[4184, 4185],
	[4190, 4192],
	[4209, 4212],
	[4229, 4230],
	[4957, 4959],
	[5906, 5908],
	[5938, 5940],
	[5970, 5971],
	[6002, 6003],
	[6068, 6069],
	[6071, 6077],
	[6089, 6099],
	[6155, 6157],
	[6277, 6278],
	[6432, 6434],
	[6439, 6440],
	[6457, 6459],
	[6679, 6680],
	[6744, 6750],
	[6757, 6764],
	[6771, 6780],
	[6832, 6846],
	[6912, 6915],
	[6966, 6970],
	[7019, 7027],
	[7040, 7041],
	[7074, 7077],
	[7080, 7081],
	[7083, 7085],
	[7144, 7145],
	[7151, 7153],
	[7212, 7219],
	[7222, 7223],
	[7376, 7378],
	[7380, 7392],
	[7394, 7400],
	[7416, 7417],
	[7616, 7673],
	[7675, 7679],
	[8203, 8207],
	[8234, 8238],
	[8288, 8292],
	[8294, 8303],
	[65024, 65039],
	[65056, 65071]
];
const ZERO_WIDTH_SINGLES = new Set([
	1471,
	1479,
	1648,
	1809,
	2045,
	2362,
	2364,
	2381,
	2433,
	2492,
	2509,
	2558,
	2620,
	2641,
	2677,
	2748,
	2765,
	2817,
	2876,
	2879,
	2893,
	2946,
	3008,
	3021,
	3072,
	3076,
	3201,
	3260,
	3263,
	3270,
	3393,
	3396,
	3405,
	3457,
	3530,
	3542,
	3633,
	3761,
	3893,
	3895,
	3897,
	4038,
	4226,
	4237,
	4253,
	6086,
	6109,
	6313,
	6450,
	6683,
	6742,
	6752,
	6754,
	6783,
	6964,
	6972,
	6978,
	7142,
	7149,
	7405,
	7412,
	65279
]);
/**
* Binary search to check if a value is within any range
*/
function isInRanges(code, ranges) {
	let left = 0;
	let right = ranges.length - 1;
	while (left <= right) {
		const mid = Math.floor((left + right) / 2);
		const [start, end] = ranges[mid];
		if (code >= start && code <= end) return true;
		else if (code < start) right = mid - 1;
		else left = mid + 1;
	}
	return false;
}
/**
* Check if a character is zero-width (combining marks, etc.)
* Based on wcwidth's zero-width table.
*
* @param code Unicode code point
* @returns True if the character has zero display width
*/
function isZeroWidth(code) {
	return ZERO_WIDTH_SINGLES.has(code) || isInRanges(code, ZERO_WIDTH_RANGES);
}
/**
* Check if a character code point represents a wide character.
* Based on wcwidth's wide character table (selected ranges from Unicode 15.1.0).
*
* @param code Unicode code point
* @returns True if the character has width 2
*/
function isWideCharacter(code) {
	return code >= 4352 && code <= 4447 || code >= 8986 && code <= 8987 || code >= 9001 && code <= 9002 || code >= 9193 && code <= 9196 || code === 9200 || code === 9203 || code >= 9725 && code <= 9726 || code >= 9748 && code <= 9749 || code >= 9800 && code <= 9811 || code === 9855 || code === 9875 || code === 9888 || code === 9889 || code === 9898 || code === 9899 || code >= 9917 && code <= 9918 || code >= 9924 && code <= 9925 || code === 9934 || code === 9940 || code >= 9962 && code <= 9962 || code >= 9970 && code <= 9971 || code === 9973 || code === 9978 || code === 9981 || code >= 9989 && code <= 9989 || code >= 9994 && code <= 9995 || code === 10024 || code === 10060 || code === 10062 || code >= 10067 && code <= 10069 || code === 10071 || code >= 10133 && code <= 10135 || code === 10160 || code === 10175 || code >= 11035 && code <= 11036 || code === 11088 || code === 11093 || code >= 11904 && code <= 11929 || code >= 11931 && code <= 12019 || code >= 12032 && code <= 12245 || code >= 12272 && code <= 12283 || code >= 12288 && code <= 12350 || code >= 12353 && code <= 12438 || code >= 12441 && code <= 12543 || code >= 12549 && code <= 12591 || code >= 12593 && code <= 12686 || code >= 12688 && code <= 12771 || code >= 12784 && code <= 12830 || code >= 12832 && code <= 12871 || code >= 12880 && code <= 19903 || code >= 19968 && code <= 40959 || code >= 43360 && code <= 43391 || code >= 44032 && code <= 55203 || code >= 55216 && code <= 55238 || code >= 63744 && code <= 64255 || code >= 65040 && code <= 65049 || code >= 65072 && code <= 65135 || code >= 65280 && code <= 65376 || code >= 65504 && code <= 65510 || code >= 94176 && code <= 94180 || code >= 94192 && code <= 94193 || code >= 94208 && code <= 100343 || code >= 100352 && code <= 101589 || code >= 101632 && code <= 101640 || code >= 110576 && code <= 110579 || code >= 110581 && code <= 110587 || code >= 110589 && code <= 110590 || code >= 110592 && code <= 110882 || code >= 110928 && code <= 110930 || code >= 110948 && code <= 110951 || code >= 110960 && code <= 111355 || code === 126980 || code === 127183 || code >= 127374 && code <= 127374 || code >= 127377 && code <= 127386 || code >= 127462 && code <= 127487 || code >= 127488 && code <= 127490 || code >= 127504 && code <= 127547 || code >= 127552 && code <= 127560 || code >= 127568 && code <= 127569 || code >= 127584 && code <= 127589 || code >= 127744 && code <= 128727 || code >= 128736 && code <= 128748 || code >= 128752 && code <= 128764 || code >= 128768 && code <= 128883 || code >= 128896 && code <= 128984 || code >= 128992 && code <= 129003 || code >= 129008 && code <= 129008 || code >= 129024 && code <= 129035 || code >= 129040 && code <= 129095 || code >= 129104 && code <= 129113 || code >= 129120 && code <= 129159 || code >= 129168 && code <= 129197 || code >= 129200 && code <= 129201 || code >= 129280 && code <= 129619 || code >= 129632 && code <= 129645 || code >= 129648 && code <= 129660 || code >= 129664 && code <= 129672 || code >= 129680 && code <= 129725 || code >= 129727 && code <= 129733 || code >= 129742 && code <= 129755 || code >= 129760 && code <= 129768 || code >= 129776 && code <= 129784 || code >= 131072 && code <= 196605 || code >= 196608 && code <= 262141;
}

//#endregion
exports.getDisplayWidth = getDisplayWidth;
exports.stripAnsi = stripAnsi;