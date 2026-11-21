use std::cell::RefCell;

thread_local! {
    static OUTPUT: RefCell<Vec<i32>> = const { RefCell::new(Vec::new()) };
}

fn write_points(points: impl IntoIterator<Item = [i32; 3]>) -> i32 {
    OUTPUT.with(|output| {
        let mut output = output.borrow_mut();
        output.clear();
        for point in points {
            output.extend_from_slice(&point);
        }
        (output.len() / 3) as i32
    })
}

#[no_mangle]
pub extern "C" fn plan_output() -> *const i32 {
    OUTPUT.with(|output| output.borrow().as_ptr())
}

#[no_mangle]
pub extern "C" fn plan_quarry(size: i32, depth: i32) -> i32 {
    if !(1..=16).contains(&size) || !(1..=64).contains(&depth) {
        return -1;
    }
    let min = -(size / 2);
    write_points((0..depth).flat_map(|dy| {
        (min..min + size).flat_map(move |dx| (min..min + size).map(move |dz| [dx, -dy, dz]))
    }))
}

#[no_mangle]
pub extern "C" fn plan_tunnel(size: i32, depth: i32, fx: i32, fz: i32, rx: i32, rz: i32) -> i32 {
    if !(1..=16).contains(&size)
        || !(1..=64).contains(&depth)
        || !(-1..=1).contains(&fx)
        || !(-1..=1).contains(&fz)
        || !(-1..=1).contains(&rx)
        || !(-1..=1).contains(&rz)
        || fx.abs() + fz.abs() != 1
        || rx.abs() + rz.abs() != 1
        || fx * rx + fz * rz != 0
    {
        return -1;
    }
    let half = (size - 1) / 2;
    write_points((1..=depth).flat_map(|step| {
        (0..=1).rev().flat_map(move |h| {
            (-half..size - half).map(move |w| [fx * step + rx * w, h, fz * step + rz * w])
        })
    }))
}

#[no_mangle]
pub extern "C" fn plan_template(kind: i32, size: i32) -> i32 {
    if !(0..=4).contains(&kind) || !(2..=16).contains(&size) {
        return -1;
    }
    let size = size.min(15);
    let half = size / 2;
    let mut points = Vec::new();
    match kind {
        1 => {
            for y in 0..3 {
                for x in -half..=half {
                    points.push([x, y, 2]);
                }
            }
        }
        2 => {
            for y in 0..size {
                points.push([1, y, 0]);
            }
        }
        3 => {
            for z in 1..=size {
                points.push([0, -1, z]);
            }
        }
        4 => {
            for y in 0..3 {
                for x in -2_i32..=2 {
                    for z in -2_i32..=2 {
                        let edge = x.abs() == 2 || z.abs() == 2;
                        let door = x == 0 && z == 2 && y < 2;
                        if (edge && !door) || y == 2 {
                            points.push([x, y, z]);
                        }
                    }
                }
            }
        }
        _ => {
            for x in -half..=half {
                for z in -half..=half {
                    if x != 0 || z != 0 {
                        points.push([x, 0, z]);
                    }
                }
            }
        }
    }
    write_points(points)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn points() -> Vec<i32> {
        OUTPUT.with(|output| output.borrow().clone())
    }

    #[test]
    fn quarry_has_exact_odd_and_even_dimensions() {
        for size in 1..=16 {
            assert_eq!(plan_quarry(size, 3), size * size * 3);
            assert_eq!(points().len(), (size * size * 3 * 3) as usize);
        }
        assert_eq!(plan_quarry(2, 1), 4);
        assert_eq!(points(), [-1, 0, -1, -1, 0, 0, 0, 0, -1, 0, 0, 0]);
    }

    #[test]
    fn tunnel_and_invalid_inputs() {
        assert_eq!(plan_tunnel(2, 3, 0, -1, 1, 0), 12);
        assert_eq!(&points()[..6], &[0, 1, -1, 1, 1, -1]);
        assert_eq!(plan_quarry(0, 1), -1);
        assert_eq!(plan_tunnel(2, 1, 0, 0, 1, 0), -1);
        assert_eq!(plan_template(5, 2), -1);
    }

    #[test]
    fn template_shapes_match_original() {
        assert_eq!(plan_template(0, 2), 8);
        assert_eq!(plan_template(1, 2), 9);
        assert_eq!(plan_template(2, 3), 3);
        assert_eq!(plan_template(3, 3), 3);
        assert_eq!(plan_template(4, 3), 55);
    }
}
