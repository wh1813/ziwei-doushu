/**
 * lunar-javascript 最小类型声明
 *
 * 仅声明奇门引擎所用的 API 面（Solar/Lunar/JieQi）。
 * 库本体为无类型的 JS（prototype 风格），此声明使 strict 模式下可安全导入。
 */
declare module 'lunar-javascript' {
  export interface JieQi {
    getName(): string;
    getSolar(): Solar;
  }

  export class Lunar {
    getYear(): number;
    getMonth(): number; // 闰月为负数
    getDay(): number;
    getMonthInChinese(): string;
    getDayInChinese(): string;
    getYearInGanZhiExact(): string;
    getMonthInGanZhiExact(): string;
    getDayInGanZhiExact(): string;
    getTimeInGanZhi(): string;
    getDayXunExact(): string;
    getDayXunKongExact(): string;
    getTimeXun(): string;
    getTimeXunKong(): string;
    getPrevJie(wholeDay?: boolean): JieQi;
    getNextJie(wholeDay?: boolean): JieQi;
    getJieQiTable(): Record<string, JieQi>;
  }

  export class Solar {
    static fromYmd(year: number, month: number, day: number): Solar;
    static fromYmdHms(
      year: number,
      month: number,
      day: number,
      hour: number,
      minute: number,
      second: number,
    ): Solar;
    getLunar(): Lunar;
    getYear(): number;
    getMonth(): number;
    getDay(): number;
    getHour(): number;
    getMinute(): number;
    getSecond(): number;
    toYmd(): string;
    toYmdHms(): string;
  }
}
