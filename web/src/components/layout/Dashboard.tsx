// The dashboard: columns c1..cN of sections as arranged in the Layout dialog, with dividers between columns and
// between the sections of a column. On narrow screens the sections stack, in the same order, at natural size.
import {Fragment, type ComponentType} from 'react';
import {useDesktop} from '../../hooks/dom';
import {useLayout, type Sizes} from '../../store/layout';
import {DrivingPanel} from '../panels/DrivingPanel';
import {LapPanel} from '../panels/LapPanel';
import {MapPanel} from '../panels/MapPanel';
import {StandingsPanel} from '../panels/StandingsPanel';
import {StrategyPanel} from '../panels/StrategyPanel';
import {TyresPanel} from '../panels/TyresPanel';
import {Splitter} from './Splitter';

interface Section {
  title: string;
  className: string;
  Panel: ComponentType;
}
export const SECTIONS: Record<string, Section> = {
  'p-driving': {title: 'Driving', className: 'driving', Panel: DrivingPanel},
  'p-tyres': {title: 'Tyres & car', className: 'tyres', Panel: TyresPanel},
  'p-lap': {title: 'Lap timing', className: 'lap', Panel: LapPanel},
  'p-map': {title: 'Track map', className: 'map', Panel: MapPanel},
  'p-standings': {title: 'Standings', className: 'standings', Panel: StandingsPanel},
  'p-strategy': {title: 'Strategy', className: 'strategy', Panel: StrategyPanel},
};

const flex = (sizes: Sizes, id: string, desktop: boolean) => (desktop && sizes[id] ? {flex: `${sizes[id]} 1 0`} : undefined);

export function Dashboard() {
  const desktop = useDesktop();
  const {arrangement, sizes} = useLayout();
  return (
    <main>
      {arrangement.cols.map((list, i) => {
        const colId = `c${i + 1}`;
        return (
          <Fragment key={colId}>
            {i > 0 && <Splitter dir="x" />}
            <div className="col" id={colId} style={flex(sizes, colId, desktop)}>
              {list.map((id, k) => {
                const {className, Panel} = SECTIONS[id];
                return (
                  <Fragment key={id}>
                    {k > 0 && <Splitter dir="y" />}
                    <section className={`card ${className}`} id={id} style={flex(sizes, id, desktop)}>
                      <Panel />
                    </section>
                  </Fragment>
                );
              })}
            </div>
          </Fragment>
        );
      })}
    </main>
  );
}
