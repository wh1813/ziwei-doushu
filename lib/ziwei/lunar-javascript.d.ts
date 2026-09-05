/**
 * lunar-javascript 最小类型声明（全站共用唯一一份）
 *
 * 覆盖：紫微（lib/ziwei/*）与奇门（lib/qimen/engine.ts）两处调用面。
 * 库本体为无类型的 JS（prototype 风格），此声明使 strict 模式下可安全导入。
 * 注意：仓库内不得再有第二份 `declare module 'lunar-javascript'`，多份声明会合并冲突
 * （曾导致构建报 "Property 'fromYmdHms' does not exist on type 'typeof Solar'"）。
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
    getYearGan(): string;
    getYearZhi(): string;
    getMonthGan(): string;
    getMonthZhi(): string;
    getDayGan(): string;
    getDayZhi(): string;
    getMonthInChinese(): string;
    getDayInChinese(): string;
    getYearInGanZhiExact(): string;
    getMonthInGanZhiExact(): string;
    getDayInGanZhiExact(): string;
    getTimeInGanZhi(): string;
    getYearShengXiao(): string;
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
