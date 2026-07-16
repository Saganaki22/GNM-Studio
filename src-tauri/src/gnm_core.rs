//! Native Rust implementation of the released GNM v3 head deformation math.
//!
//! The Python package remains the numerical reference and build-time asset
//! converter. This module loads the released NPZ arrays directly and evaluates
//! identity, expression, pose correctives, forward kinematics, and linear blend
//! skinning without Python or TensorFlow at runtime.

use std::io::{Cursor, Read, Seek};

#[cfg(test)]
use std::{fs::File, io::BufReader, path::Path};

use ndarray::{Array1, Array2, Array3};
use ndarray_npy::NpzReader;
use serde::Serialize;
use thiserror::Error;

const EPSILON: f32 = 1e-8;

#[derive(Debug, Error)]
pub enum GnmError {
    #[cfg(test)]
    #[error("could not open the GNM asset: {0}")]
    Io(#[from] std::io::Error),
    #[error("could not read the GNM NPZ asset: {0}")]
    Npz(#[from] ndarray_npy::ReadNpzError),
    #[error("{0} parameter count mismatch: expected {1}, received {2}")]
    ParameterCount(&'static str, usize, usize),
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GnmModelInfo {
    pub vertices: usize,
    pub triangles: usize,
    pub joints: usize,
    pub identity_dimensions: usize,
    pub expression_dimensions: usize,
}

pub struct GnmModel {
    template_vertices: Array2<f32>,
    template_joints: Array2<f32>,
    vertex_identity_basis: Array3<f32>,
    joint_identity_basis: Array3<f32>,
    expression_basis: Array3<f32>,
    pose_correctives: Array2<f32>,
    skinning_weights: Array2<f32>,
    parent_indices: Array1<i32>,
    triangles: Array2<i32>,
}

impl GnmModel {
    #[cfg(test)]
    pub fn load(path: impl AsRef<Path>) -> Result<Self, GnmError> {
        let reader = BufReader::new(File::open(path)?);
        Self::from_reader(reader)
    }

    pub fn from_bytes(bytes: &'static [u8]) -> Result<Self, GnmError> {
        Self::from_reader(Cursor::new(bytes))
    }

    fn from_reader<R: Read + Seek>(reader: R) -> Result<Self, GnmError> {
        let mut archive = NpzReader::new(reader)?;
        Ok(Self {
            template_vertices: archive.by_name("template_vertex_positions.npy")?,
            template_joints: archive.by_name("template_joint_positions.npy")?,
            vertex_identity_basis: archive.by_name("vertex_identity_basis.npy")?,
            joint_identity_basis: archive.by_name("joint_identity_basis.npy")?,
            expression_basis: archive.by_name("expression_basis.npy")?,
            pose_correctives: archive.by_name("pose_correctives_regressor.npy")?,
            skinning_weights: archive.by_name("skinning_weights.npy")?,
            parent_indices: archive.by_name("joint_parent_indices.npy")?,
            triangles: archive.by_name("triangles.npy")?,
        })
    }

    pub fn info(&self) -> GnmModelInfo {
        GnmModelInfo {
            vertices: self.template_vertices.nrows(),
            triangles: self.triangles.nrows(),
            joints: self.template_joints.nrows(),
            identity_dimensions: self.vertex_identity_basis.dim().0,
            expression_dimensions: self.expression_basis.dim().0,
        }
    }

    pub fn evaluate(
        &self,
        identity: &[f32],
        expression: &[f32],
        rotations: &[[f32; 3]],
        translation: [f32; 3],
    ) -> Result<Vec<[f32; 3]>, GnmError> {
        let info = self.info();
        check_count("identity", info.identity_dimensions, identity.len())?;
        check_count("expression", info.expression_dimensions, expression.len())?;
        check_count("rotation", info.joints, rotations.len())?;

        let mut vertices = self.template_vertices.clone();
        for (component, &weight) in identity.iter().enumerate() {
            if weight.abs() <= f32::EPSILON {
                continue;
            }
            for vertex in 0..info.vertices {
                for axis in 0..3 {
                    vertices[[vertex, axis]] +=
                        weight * self.vertex_identity_basis[[component, vertex, axis]];
                }
            }
        }
        for (component, &weight) in expression.iter().enumerate() {
            if weight.abs() <= f32::EPSILON {
                continue;
            }
            for vertex in 0..info.vertices {
                for axis in 0..3 {
                    vertices[[vertex, axis]] +=
                        weight * self.expression_basis[[component, vertex, axis]];
                }
            }
        }

        let mut joints = self.template_joints.clone();
        for (component, &weight) in identity.iter().enumerate() {
            if weight.abs() <= f32::EPSILON {
                continue;
            }
            for joint in 0..info.joints {
                for axis in 0..3 {
                    joints[[joint, axis]] +=
                        weight * self.joint_identity_basis[[component, joint, axis]];
                }
            }
        }

        let rotation_matrices: Vec<Mat3> = rotations
            .iter()
            .copied()
            .map(axis_angle_to_matrix)
            .collect();

        for joint in 0..info.joints {
            for row in 0..3 {
                for column in 0..3 {
                    let feature = rotation_matrices[joint][row][column]
                        - if row == column { 1.0 } else { 0.0 };
                    let feature_index = joint * 9 + row * 3 + column;
                    if feature.abs() <= f32::EPSILON {
                        continue;
                    }
                    for flat_vertex_axis in 0..info.vertices * 3 {
                        let vertex = flat_vertex_axis / 3;
                        let axis = flat_vertex_axis % 3;
                        vertices[[vertex, axis]] +=
                            feature * self.pose_correctives[[feature_index, flat_vertex_axis]];
                    }
                }
            }
        }

        let mut world = vec![identity4(); info.joints];
        for joint in 0..info.joints {
            let parent = self.parent_indices[joint].max(0) as usize;
            let local_translation = if joint == 0 {
                [
                    joints[[0, 0]] + translation[0],
                    joints[[0, 1]] + translation[1],
                    joints[[0, 2]] + translation[2],
                ]
            } else {
                [
                    joints[[joint, 0]] - joints[[parent, 0]],
                    joints[[joint, 1]] - joints[[parent, 1]],
                    joints[[joint, 2]] - joints[[parent, 2]],
                ]
            };
            let local = transform(rotation_matrices[joint], local_translation);
            world[joint] = if joint == 0 {
                local
            } else {
                multiply4(world[parent], local)
            };
        }

        let mut skinning_transforms = world.clone();
        for joint in 0..info.joints {
            let bind_joint = [joints[[joint, 0]], joints[[joint, 1]], joints[[joint, 2]]];
            let delta = multiply3_vec(rotation_part(world[joint]), bind_joint);
            skinning_transforms[joint][0][3] -= delta[0];
            skinning_transforms[joint][1][3] -= delta[1];
            skinning_transforms[joint][2][3] -= delta[2];
        }

        let mut output = vec![[0.0; 3]; info.vertices];
        for vertex in 0..info.vertices {
            let source = [
                vertices[[vertex, 0]],
                vertices[[vertex, 1]],
                vertices[[vertex, 2]],
                1.0,
            ];
            for joint in 0..info.joints {
                let weight = self.skinning_weights[[joint, vertex]];
                if weight.abs() <= f32::EPSILON {
                    continue;
                }
                let transformed = multiply4_vec(skinning_transforms[joint], source);
                for axis in 0..3 {
                    output[vertex][axis] += weight * transformed[axis];
                }
            }
        }
        Ok(output)
    }
}

fn check_count(name: &'static str, expected: usize, actual: usize) -> Result<(), GnmError> {
    if expected != actual {
        return Err(GnmError::ParameterCount(name, expected, actual));
    }
    Ok(())
}

type Mat3 = [[f32; 3]; 3];
type Mat4 = [[f32; 4]; 4];

fn axis_angle_to_matrix(axis_angle: [f32; 3]) -> Mat3 {
    let norm_squared = axis_angle.iter().map(|value| value * value).sum::<f32>();
    let angle = norm_squared.max(EPSILON).sqrt();
    let axis = [
        axis_angle[0] / angle,
        axis_angle[1] / angle,
        axis_angle[2] / angle,
    ];
    let sine = angle.sin();
    let cosine = angle.cos();
    let one_minus_cosine = 1.0 - cosine;
    [
        [
            cosine + axis[0] * axis[0] * one_minus_cosine,
            axis[0] * axis[1] * one_minus_cosine - axis[2] * sine,
            axis[0] * axis[2] * one_minus_cosine + axis[1] * sine,
        ],
        [
            axis[1] * axis[0] * one_minus_cosine + axis[2] * sine,
            cosine + axis[1] * axis[1] * one_minus_cosine,
            axis[1] * axis[2] * one_minus_cosine - axis[0] * sine,
        ],
        [
            axis[2] * axis[0] * one_minus_cosine - axis[1] * sine,
            axis[2] * axis[1] * one_minus_cosine + axis[0] * sine,
            cosine + axis[2] * axis[2] * one_minus_cosine,
        ],
    ]
}

fn identity4() -> Mat4 {
    [
        [1.0, 0.0, 0.0, 0.0],
        [0.0, 1.0, 0.0, 0.0],
        [0.0, 0.0, 1.0, 0.0],
        [0.0, 0.0, 0.0, 1.0],
    ]
}

fn transform(rotation: Mat3, translation: [f32; 3]) -> Mat4 {
    [
        [
            rotation[0][0],
            rotation[0][1],
            rotation[0][2],
            translation[0],
        ],
        [
            rotation[1][0],
            rotation[1][1],
            rotation[1][2],
            translation[1],
        ],
        [
            rotation[2][0],
            rotation[2][1],
            rotation[2][2],
            translation[2],
        ],
        [0.0, 0.0, 0.0, 1.0],
    ]
}

fn multiply4(left: Mat4, right: Mat4) -> Mat4 {
    let mut result = [[0.0; 4]; 4];
    for row in 0..4 {
        for column in 0..4 {
            for inner in 0..4 {
                result[row][column] += left[row][inner] * right[inner][column];
            }
        }
    }
    result
}

fn multiply4_vec(matrix: Mat4, vector: [f32; 4]) -> [f32; 4] {
    let mut result = [0.0; 4];
    for row in 0..4 {
        for column in 0..4 {
            result[row] += matrix[row][column] * vector[column];
        }
    }
    result
}

fn rotation_part(matrix: Mat4) -> Mat3 {
    [
        [matrix[0][0], matrix[0][1], matrix[0][2]],
        [matrix[1][0], matrix[1][1], matrix[1][2]],
        [matrix[2][0], matrix[2][1], matrix[2][2]],
    ]
}

fn multiply3_vec(matrix: Mat3, vector: [f32; 3]) -> [f32; 3] {
    [
        matrix[0][0] * vector[0] + matrix[0][1] * vector[1] + matrix[0][2] * vector[2],
        matrix[1][0] * vector[0] + matrix[1][1] * vector[1] + matrix[1][2] * vector[2],
        matrix[2][0] * vector[0] + matrix[2][1] * vector[1] + matrix[2][2] * vector[2],
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn released_model_path() -> std::path::PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("gnm_head.npz")
    }

    #[test]
    fn released_model_loads_with_expected_dimensions() {
        let model = GnmModel::load(released_model_path()).expect("released GNM model should load");
        let info = model.info();
        assert_eq!(info.vertices, 17_821);
        assert_eq!(info.triangles, 35_324);
        assert_eq!(info.joints, 4);
        assert_eq!(info.identity_dimensions, 253);
        assert_eq!(info.expression_dimensions, 383);
    }

    #[test]
    fn neutral_evaluation_reproduces_the_template() {
        let model = GnmModel::load(released_model_path()).expect("released GNM model should load");
        let info = model.info();
        let output = model
            .evaluate(
                &vec![0.0; info.identity_dimensions],
                &vec![0.0; info.expression_dimensions],
                &vec![[0.0; 3]; info.joints],
                [0.0; 3],
            )
            .expect("neutral evaluation should succeed");
        let mut maximum_error = 0.0_f32;
        for (vertex, value) in output.iter().enumerate() {
            for axis in 0..3 {
                maximum_error = maximum_error
                    .max((value[axis] - model.template_vertices[[vertex, axis]]).abs());
            }
        }
        assert!(maximum_error < 1e-5, "maximum error was {maximum_error}");
    }

    #[test]
    fn posed_evaluation_matches_python_reference() {
        let model = GnmModel::load(released_model_path()).expect("released GNM model should load");
        let info = model.info();
        let mut identity = vec![0.0; info.identity_dimensions];
        identity[..5].copy_from_slice(&[0.2, -0.1, 0.05, 0.15, -0.08]);
        let mut expression = vec![0.0; info.expression_dimensions];
        expression[..5].copy_from_slice(&[0.3, -0.2, 0.1, 0.05, -0.12]);
        let rotations = vec![
            [0.05, -0.03, 0.02],
            [0.1, 0.04, -0.06],
            [-0.02, 0.08, 0.03],
            [0.04, -0.07, 0.01],
        ];
        let output = model
            .evaluate(&identity, &expression, &rotations, [0.01, -0.02, 0.03])
            .expect("posed evaluation should succeed");
        let expected = [
            (0, [0.06403931, 0.13797502, 0.05404025]),
            (100, [0.07011187, 0.15099317, 0.01014329]),
            (1_000, [0.02242816, 0.26271677, 0.16212103]),
            (10_000, [-0.05772833, 0.24265987, 0.12255438]),
            (17_820, [-0.02481171, 0.27707356, 0.13528235]),
        ];

        for (vertex, reference) in expected {
            for axis in 0..3 {
                let error = (output[vertex][axis] - reference[axis]).abs();
                assert!(
                    error < 2e-5,
                    "vertex {vertex}, axis {axis}: expected {}, got {}, error {error}",
                    reference[axis],
                    output[vertex][axis]
                );
            }
        }
    }
}
